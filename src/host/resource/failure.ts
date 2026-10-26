import { RpcError } from "../../../rpc/errors.js";
import type { ResourceFailureCode } from "../../../rpc/resource.js";
import { ResourceError } from "../../resource/errors.js";
import type { ResourceErrorCode } from "../../resource/errors.js";

const codes: Partial<Record<ResourceErrorCode, ResourceFailureCode>> = {
  "project-unavailable": "project-unavailable",
  "workspace-unavailable": "resource-unavailable",
  "resource-unavailable": "resource-unavailable",
  "resource-content-unavailable": "resource-unavailable",
  "folder-unavailable": "folder-unavailable",
  "folder-conflict": "path-conflict",
  "resource-already-exists": "path-conflict",
  "stale-revision": "revision-conflict",
  "operation-result-stale": "operation-conflict",
  "content-state-conflict": "operation-conflict",
  "query-changed": "query-changed",
  "invalid-resource": "invalid-request",
  "invalid-access": "invalid-request",
};

export function toResourceFailure(error: unknown): RpcError {
  if (error instanceof RpcError) return error;
  if (error instanceof ResourceError) {
    const code = codes[error.code];
    if (code !== undefined) return failure(code, error.message);
  }
  process.stderr.write(`[kernel-host] resource method failed: ${describe(error)}\n`);
  return failure("internal", "Resource operation failed.");
}

function failure(code: ResourceFailureCode, message: string): RpcError {
  return new RpcError("remote-error", message, { failure: { code, message, details: {} } });
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "Unknown failure";
}
