import { RpcError } from "../errors.js";
import type { RpcMethod } from "../protocol.js";
import type { RpcStreamHandler } from "../stream.js";

export interface RegisteredMethod {
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
