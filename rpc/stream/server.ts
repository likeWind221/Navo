import { RpcError } from "../errors.js";
import { RPC_PROTOCOL_VERSION } from "../protocol.js";
import type { RpcFailure } from "../protocol.js";
import { isJsonValue, parseRpcClientFrame } from "../validation.js";
import type { RpcServerTransport } from "../stream.js";
import type { RegisteredMethod, StreamRpcRouter } from "./router.js";
import { createOutputValidator } from "./validation.js";

export class StreamRpcServer {
  private readonly active = new Map<string, AbortController>();
  private readonly tasks = new Set<Promise<void>>();
  private closing = false;
  private drainPromise: Promise<void> | undefined;
  private disposePromise: Promise<void> | undefined;

  constructor(
    private readonly transport: RpcServerTransport,
    private readonly router: StreamRpcRouter,
  ) {}

  async serve(): Promise<void> {
    try {
      for await (const candidate of this.transport.incoming) {
        if (this.closing) break;
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
        const task = this.run(frame.id, registered, input, controller);
        this.tasks.add(task);
        // Attach both handlers immediately: detached request failures remain
        // observed even before shutdown begins waiting for the task set.
        void task.then(
          () => this.tasks.delete(task),
          () => this.tasks.delete(task),
        );
      }
    } finally {
      await this.stopAndDrain();
    }
  }

  dispose(): Promise<void> {
    if (this.disposePromise === undefined) {
      this.disposePromise = this.closeAfterDrain();
    }
    return this.disposePromise;
  }

  private async run(
    id: string,
    registered: RegisteredMethod,
    input: unknown,
    controller: AbortController,
  ): Promise<void> {
    try {
      const outputValidator = createOutputValidator(registered.method, input);
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

  private stopAndDrain(): Promise<void> {
    if (this.drainPromise !== undefined) return this.drainPromise;
    this.closing = true;
    for (const controller of this.active.values()) controller.abort();
    this.drainPromise = Promise.allSettled([...this.tasks]).then(() => {
      this.active.clear();
    });
    return this.drainPromise;
  }

  private async closeAfterDrain(): Promise<void> {
    await this.stopAndDrain();
    await this.transport.close();
  }
}

function failure(code: string, message: string): RpcFailure {
  return { code, message, details: {} };
}
