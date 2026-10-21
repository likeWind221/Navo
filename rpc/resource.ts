import type { RpcMethod } from "./protocol.js";
import { RpcError } from "./errors.js";
import { exactKeys, requireBoundedString, requireRecord } from "./validation.js";

export interface UserImportInputV1 {
  readonly projectId: string;
  readonly requestId: string;
  readonly sources: readonly { readonly kind: "file" | "directory"; readonly path: string }[];
}

export type UserImportItemV1 =
  | { readonly status: "saved"; readonly name: string; readonly relativePath: string;
      readonly resourceId: string; readonly libraryPath: string;
      readonly contentStatus: "pending" | "processing" | "ready" | "metadata_only" | "failed" | null }
  | { readonly status: "failed"; readonly name: string; readonly relativePath: string;
      readonly code: string; readonly message: string }
  | { readonly status: "cancelled"; readonly name: string; readonly relativePath: string };

export const userImportMethod: RpcMethod<UserImportInputV1, UserImportItemV1> = Object.freeze({
  name: "resource.user-import.v1",
  parseInput,
  parseOutput,
});

function parseInput(value: unknown): UserImportInputV1 {
  const input = shape(value, ["projectId", "requestId", "sources"]);
  if (!Array.isArray(input.sources) || input.sources.length < 1 || input.sources.length > 32) invalid();
  const requestId = requireBoundedString(input.requestId, "requestId", 64);
  if (!/^[a-zA-Z0-9_-]+$/.test(requestId)) invalid();
  return {
    projectId: requireBoundedString(input.projectId, "projectId", 128),
    requestId,
    sources: input.sources.map(value => {
      const source = shape(value, ["kind", "path"]);
      if (source.kind !== "file" && source.kind !== "directory") return invalid();
      return { kind: source.kind, path: requireBoundedString(source.path, "source path", 4096) };
    }),
  };
}

function parseOutput(value: unknown): UserImportItemV1 {
  const item = requireRecord(value, "import item");
  if (item.status === "saved" && exactKeys(item,
    ["status", "name", "relativePath", "resourceId", "libraryPath", "contentStatus"])) {
    const status = item.contentStatus;
    if (status !== null && status !== "pending" && status !== "processing" && status !== "ready"
      && status !== "metadata_only" && status !== "failed") return invalid();
    return { status: "saved", name: label(item.name), relativePath: label(item.relativePath),
      resourceId: label(item.resourceId), libraryPath: label(item.libraryPath), contentStatus: status };
  }
  if (item.status === "failed" && exactKeys(item, ["status", "name", "relativePath", "code", "message"])) {
    return { status: "failed", name: label(item.name), relativePath: label(item.relativePath),
      code: label(item.code), message: label(item.message) };
  }
  if (item.status === "cancelled" && exactKeys(item, ["status", "name", "relativePath"])) {
    return { status: "cancelled", name: label(item.name), relativePath: label(item.relativePath) };
  }
  return invalid();
}

function label(value: unknown): string {
  return requireBoundedString(value, "import result field", 4096);
}

function shape(value: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = requireRecord(value, "import input");
  if (!exactKeys(record, keys)) invalid();
  return record;
}

function invalid(): never {
  throw new RpcError("invalid-input", "Malformed user import data.");
}
