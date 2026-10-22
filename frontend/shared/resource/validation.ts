import type { ResourceFailureCode, UserImportSourceV1 } from "../../../rpc/resource.js";
import { parseLibrarySnapshot, parseUserImportItem } from "../../../rpc/resource/validation.js";
import { exactKeys, requireBoundedString, requireRecord } from "../../../rpc/validation.js";
import type {
  DesktopResourceEvent,
  DesktopResourceFailure,
  DesktopResourceFailureCode,
  DesktopResourceResult,
  DesktopResourceStreamHandle,
} from "../resource.js";

export const DESKTOP_RESOURCE_FAILURE_MESSAGE_MAX_CHARS = 2_048;
const ID_MAX = 128;
const PATH_MAX = 4_096;

const RESOURCE_FAILURE_CODES: readonly ResourceFailureCode[] = [
  "invalid-request", "project-unavailable", "resource-unavailable", "folder-unavailable",
  "path-conflict", "revision-conflict", "operation-conflict", "internal",
];

const BRIDGE_FAILURE_CODES: readonly DesktopResourceFailureCode[] = [
  "cancelled", "host-unavailable", "invalid-input", "invalid-output", "bridge-closed",
];

export function parseDesktopResourceResult<T>(
  value: unknown,
  parseValue: (value: unknown) => T,
): DesktopResourceResult<T> {
  const result = requireRecord(value, "desktop resource result");
  if (result.type === "ok" && exactKeys(result, ["type", "value"])) {
    return { type: "ok", value: parseValue(result.value) };
  }
  if (result.type === "failed" && exactKeys(result, ["type", "failure"])) {
    return { type: "failed", failure: parseDesktopResourceFailure(result.failure) };
  }
  throw new Error("Malformed desktop resource result");
}

export function parseDesktopResourceHandle(value: unknown): DesktopResourceStreamHandle {
  const handle = requireRecord(value, "desktop resource stream handle");
  if (!exactKeys(handle, ["subscriptionId"])) throw new Error("Malformed resource stream handle");
  return { subscriptionId: parseDesktopResourceOperationId(handle.subscriptionId) };
}

export function parseDesktopResourceEvent(value: unknown): DesktopResourceEvent {
  const event = requireRecord(value, "desktop resource event");
  const subscriptionId = parseDesktopResourceOperationId(event.subscriptionId);
  if (event.type === "import-item" && exactKeys(event, ["type", "subscriptionId", "item"])) {
    return { type: "import-item", subscriptionId, item: parseUserImportItem(event.item) };
  }
  if (event.type === "library-snapshot" && exactKeys(event, ["type", "subscriptionId", "snapshot"])) {
    return { type: "library-snapshot", subscriptionId, snapshot: parseLibrarySnapshot(event.snapshot) };
  }
  if (event.type === "stream-complete" && exactKeys(event, ["type", "subscriptionId", "status"])
    && (event.status === "completed" || event.status === "cancelled")) {
    return { type: "stream-complete", subscriptionId, status: event.status };
  }
  if (event.type === "stream-error" && exactKeys(event, ["type", "subscriptionId", "failure"])) {
    return { type: "stream-error", subscriptionId, failure: parseDesktopResourceFailure(event.failure) };
  }
  throw new Error("Malformed desktop resource event");
}

export function parseDesktopResourceOperationId(value: unknown): string {
  return requireBoundedString(value, "resource operation identity", ID_MAX);
}

export function parseDesktopResourceNull(value: unknown): null {
  if (value !== null) throw new Error("Malformed desktop resource null result");
  return null;
}

export function parseDesktopResourceSources(value: unknown): readonly UserImportSourceV1[] {
  if (!Array.isArray(value) || value.length > 32) throw new Error("Malformed selected resource sources");
  return value.map(candidate => {
    const source = requireRecord(candidate, "selected resource source");
    if (!exactKeys(source, ["kind", "path"]) || (source.kind !== "file" && source.kind !== "directory")) {
      throw new Error("Malformed selected resource source");
    }
    return { kind: source.kind, path: requireBoundedString(source.path, "selected source path", PATH_MAX) };
  });
}

export function parseDesktopReplacementPath(value: unknown): string | null {
  return value === null ? null : requireBoundedString(value, "replacement path", PATH_MAX);
}

export function isResourceFailureCode(value: unknown): value is ResourceFailureCode {
  return (RESOURCE_FAILURE_CODES as readonly unknown[]).includes(value);
}

function parseDesktopResourceFailure(value: unknown): DesktopResourceFailure {
  const failure = requireRecord(value, "desktop resource failure");
  if (!exactKeys(failure, ["code", "message"])) throw new Error("Malformed desktop resource failure");
  const code = failure.code;
  if (!isResourceFailureCode(code) && !(BRIDGE_FAILURE_CODES as readonly unknown[]).includes(code)) {
    throw new Error("Unknown desktop resource failure code");
  }
  return { code: code as DesktopResourceFailureCode,
    message: requireBoundedString(failure.message, "resource failure message", DESKTOP_RESOURCE_FAILURE_MESSAGE_MAX_CHARS) };
}
