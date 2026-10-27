import { RpcError } from "../../../rpc/errors.js";
import type { JsonValue } from "../../../rpc/protocol.js";
import type { SessionFailureCode } from "../../../rpc/session.js";
import { OrdinarySessionDirectoryError } from "../../session/directory.js";

export function sessionFailure(
  code: SessionFailureCode,
  message: string,
  details: Readonly<Record<string, JsonValue>> = {},
): RpcError {
  return new RpcError("remote-error", message, { failure: { code, message, details } });
}

export function toSessionFailure(error: unknown): RpcError {
  if (error instanceof RpcError) return error;
  if (error instanceof OrdinarySessionDirectoryError) return sessionFailure(mapDirectoryCode(error.code), error.message);
  process.stderr.write(`[kernel-host] session method failed: ${describe(error)}\n`);
  return sessionFailure("internal", "Session operation failed.");
}

function mapDirectoryCode(code: OrdinarySessionDirectoryError["code"]): SessionFailureCode {
  return code;
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "Unknown failure";
}
