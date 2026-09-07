import type { RpcMethod, RpcOutputValidator } from "../protocol.js";

export function createOutputValidator<TInput, TOutput>(method: RpcMethod<TInput, TOutput>, input: TInput): RpcOutputValidator<TOutput> {
  return method.createOutputValidator?.(input) ?? {
    parse: method.parseOutput,
    end: () => undefined,
  };
}
