import { RpcError } from "./errors.js";
import { RPC_PROTOCOL_VERSION } from "./protocol.js";
import type {
  RpcClientFrame,
  RpcFailure,
  RpcMethod,
  RpcOutputValidator,
  RpcServerFrame,
} from "./protocol.js";
import {
  isJsonValue,
  parseRpcClientFrame,
  parseRpcServerFrame,
} from "./validation.js";

export interface RpcClientTransport {
  readonly incoming: AsyncIterable<unknown>;
  send(frame: RpcClientFrame): void | Promise<void>;
  close(): void | Promise<void>;
}

export interface RpcServerTransport {
  readonly incoming: AsyncIterable<unknown>;
  send(frame: RpcServerFrame): void | Promise<void>;
  close(): void | Promise<void>;
}

export interface RpcStreamOptions {
  readonly signal?: AbortSignal;
}

export type RpcStreamHandler<TInput, TOutput> = (
  input: TInput,
  signal: AbortSignal,
) => AsyncIterable<TOutput>;

interface RegisteredMethod {
  readonly method: RpcMethod<unknown, unknown>;
  readonly handler: RpcStreamHandler<unknown, unknown>;
}

export class StreamRpcRouter {
  private readonly methods = new Map<string, RegisteredMethod>();

  register<TInput, TOutput>(
    method: RpcMethod<TInput, TOutput>,
    handler: RpcStreamHandler<TInput, TOutput>,
  ): () => void {
    if (this.methods.has(method.name)) throw new RpcError("duplicate-request", `RPC method already registered: ${method.name}`);
    const registered: RegisteredMethod = {
      method: method as RpcMethod<unknown, unknown>,
      handler: handler as RpcStreamHandler<unknown, unknown>,
    };
    this.methods.set(method.name, registered);
    return () => {
      if (this.methods.get(method.name) === registered) this.methods.delete(method.name);
    };
  }

  resolve(name: string): RegisteredMethod | undefined {
    return this.methods.get(name);
  }
}

export class StreamRpcClient {
  private readonly streams = new Map<string, AsyncQueue<unknown>>();
  private readonly pump: Promise<void>;
  private disposed = false;

  constructor(
    private readonly transport: RpcClientTransport,
    private readonly createId: () => string = () => crypto.randomUUID(),
  ) {
    this.pump = this.consume();
  }

  async *stream<TInput, TOutput>(
    method: RpcMethod<TInput, TOutput>,
    input: TInput,
    options: RpcStreamOptions = {},
  ): AsyncGenerator<TOutput> {
    if (this.disposed) throw new RpcError("connection-closed", "RPC client is closed");
    const params = method.parseInput(input);
    const outputValidator = createOutputValidator(method);
    const id = this.createId();
    if (this.streams.has(id)) throw new RpcError("duplicate-request", `Duplicate RPC id: ${id}`);
    const queue = new AsyncQueue<unknown>();
    this.streams.set(id, queue);

    const abort = (): void => {
      if (!this.streams.delete(id)) return;
      void Promise.resolve(
        this.transport.send({ version: RPC_PROTOCOL_VERSION, type: "cancel", id }),
      ).catch(() => undefined);
      queue.fail(new RpcError("cancelled", "RPC stream was cancelled"));
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      if (options.signal?.aborted === true) abort();
      else await this.transport.send({ version: RPC_PROTOCOL_VERSION, type: "open", id, method: method.name, params });
      for await (const value of queue) yield outputValidator.parse(value);
      outputValidator.end();
    } finally {
      options.signal?.removeEventListener("abort", abort);
      if (this.streams.delete(id)) await this.transport.send({ version: RPC_PROTOCOL_VERSION, type: "cancel", id });
    }
  }

  async dispose(): Promise<void> {
    if (this.disposed) return;
    this.disposed = true;
    for (const queue of this.streams.values()) queue.fail(new RpcError("connection-closed", "RPC client closed"));
    this.streams.clear();
    await this.transport.close();
    await this.pump;
  }

  private async consume(): Promise<void> {
    try {
      for await (const candidate of this.transport.incoming) {
        const frame = parseRpcServerFrame(candidate);
        const queue = this.streams.get(frame.id);
        if (!queue) continue;
        if (frame.type === "item") queue.push(frame.value);
        else if (frame.type === "end") {
          this.streams.delete(frame.id);
          queue.end();
        } else {
          this.streams.delete(frame.id);
          queue.fail(new RpcError("remote-error", frame.error.message, { failure: frame.error }));
        }
      }
      this.failAll(new RpcError("connection-closed", "RPC transport ended"));
    } catch (error: unknown) {
      this.failAll(error instanceof Error ? error : new RpcError("connection-closed", "RPC transport failed"));
    }
  }

  private failAll(error: Error): void {
    for (const queue of this.streams.values()) queue.fail(error);
    this.streams.clear();
  }
}

export class StreamRpcServer {
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly transport: RpcServerTransport,
    private readonly router: StreamRpcRouter,
  ) {}

  async serve(): Promise<void> {
    try {
      for await (const candidate of this.transport.incoming) {
        const frame = parseRpcClientFrame(candidate);
        if (frame.type === "cancel") {
          this.active.get(frame.id)?.abort();
          continue;
        }
        if (this.active.has(frame.id)) {
          await this.sendError(frame.id, failure("duplicate-request", "RPC id is already active"));
          continue;
        }
        const registered = this.router.resolve(frame.method);
        if (!registered) {
          await this.sendError(frame.id, failure("method-not-found", "RPC method is not registered"));
          continue;
        }
        let input: unknown;
        try {
          input = registered.method.parseInput(frame.params);
        } catch {
          await this.sendError(frame.id, failure("invalid-input", "RPC method input is invalid"));
          continue;
        }
        const controller = new AbortController();
        this.active.set(frame.id, controller);
        void this.run(frame.id, registered, input, controller);
      }
    } finally {
      for (const controller of this.active.values()) controller.abort();
      this.active.clear();
    }
  }

  async dispose(): Promise<void> {
    for (const controller of this.active.values()) controller.abort();
    this.active.clear();
    await this.transport.close();
  }

  private async run(
    id: string,
    registered: RegisteredMethod,
    input: unknown,
    controller: AbortController,
  ): Promise<void> {
    try {
      const outputValidator = createOutputValidator(registered.method);
      for await (const candidate of registered.handler(input, controller.signal)) {
        const value = outputValidator.parse(candidate);
        if (!isJsonValue(value)) throw new RpcError("invalid-output", "RPC output is not JSON-safe");
        await this.transport.send({ version: RPC_PROTOCOL_VERSION, type: "item", id, value });
      }
      outputValidator.end();
      await this.transport.send({ version: RPC_PROTOCOL_VERSION, type: "end", id });
    } catch (error: unknown) {
      if (controller.signal.aborted) {
        await this.transport.send({ version: RPC_PROTOCOL_VERSION, type: "end", id });
      } else {
        await this.sendError(id, failure("stream-failed", "RPC stream handler failed"));
      }
    } finally {
      if (this.active.get(id) === controller) this.active.delete(id);
    }
  }

  private async sendError(id: string, error: RpcFailure): Promise<void> {
    await this.transport.send({ version: RPC_PROTOCOL_VERSION, type: "error", id, error });
  }
}

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(result: IteratorResult<T>) => void> = [];
  private terminalError: Error | undefined;
  private ended = false;

  push(value: T): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  fail(error: Error): void {
    if (this.ended) return;
    this.terminalError = error;
    this.end();
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      if (this.values.length > 0) yield this.values.shift() as T;
      else if (this.ended) {
        if (this.terminalError) throw this.terminalError;
        return;
      } else {
        const result = await new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
        if (result.done) {
          if (this.terminalError) throw this.terminalError;
          return;
        }
        yield result.value;
      }
    }
  }
}

function createOutputValidator<TInput, TOutput>(method: RpcMethod<TInput, TOutput>): RpcOutputValidator<TOutput> {
  return method.createOutputValidator?.() ?? {
    parse: method.parseOutput,
    end: () => undefined,
  };
}

function failure(code: string, message: string): RpcFailure {
  return { code, message, details: {} };
}
