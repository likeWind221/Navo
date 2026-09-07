import { RpcError } from "../errors.js";
import { RPC_PROTOCOL_VERSION } from "../protocol.js";
import type { RpcMethod } from "../protocol.js";
import { parseRpcServerFrame } from "../validation.js";
import type { RpcClientTransport, RpcStreamOptions } from "../stream.js";
import { AsyncQueue } from "./queue.js";
import { createOutputValidator } from "./validation.js";

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
    const outputValidator = createOutputValidator(method, params);
    const id = this.createId();
    if (this.streams.has(id)) throw new RpcError("duplicate-request", `Duplicate RPC id: ${id}`);
    const queue = new AsyncQueue<unknown>();
    this.streams.set(id, queue);
    let openPromise: Promise<void> | undefined;
    let cancelPromise: Promise<void> | undefined;

    const cancelRemote = (): Promise<void> => {
      if (cancelPromise !== undefined) return cancelPromise;
      if (openPromise === undefined) return Promise.resolve();
      cancelPromise = openPromise.then(
        () => this.transport.send({ version: RPC_PROTOCOL_VERSION, type: "cancel", id }),
        () => undefined,
      ).then(() => undefined, () => undefined);
      return cancelPromise;
    };

    const abort = (): void => {
      if (!this.streams.delete(id)) return;
      queue.fail(new RpcError("cancelled", "RPC stream was cancelled"));
      void cancelRemote();
    };
    options.signal?.addEventListener("abort", abort, { once: true });
    try {
      if (options.signal?.aborted === true) abort();
      else {
        // Defer invocation by one microtask so openPromise is assigned before a
        // transport can synchronously trigger cancellation through re-entrancy.
        openPromise = Promise.resolve().then(() =>
          this.transport.send({ version: RPC_PROTOCOL_VERSION, type: "open", id, method: method.name, params }),
        ).then(() => undefined);
        await openPromise;
      }
      for await (const value of queue) yield outputValidator.parse(value);
      outputValidator.end();
    } finally {
      options.signal?.removeEventListener("abort", abort);
      if (this.streams.delete(id)) {
        queue.end();
        await cancelRemote();
      } else if (cancelPromise !== undefined) {
        await cancelPromise;
      }
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
