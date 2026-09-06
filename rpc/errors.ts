import type { RpcFailure } from "./protocol.js";

export type RpcErrorCode =
  | "cancelled"
  | "connection-closed"
  | "duplicate-request"
  | "invalid-frame"
  | "invalid-input"
  | "invalid-output"
  | "method-not-found"
  | "remote-error";

export class RpcError extends Error {
  readonly code: RpcErrorCode;
  readonly failure?: RpcFailure;

  constructor(
    code: RpcErrorCode,
    message: string,
    options?: ErrorOptions & { readonly failure?: RpcFailure },
  ) {
    super(message, options);
    this.name = "RpcError";
    this.code = code;
    if (options?.failure !== undefined) this.failure = options.failure;
  }
}
