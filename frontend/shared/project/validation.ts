import type { ProjectFailureCode } from "../../../rpc/project.js";
import { PROJECT_WORKSPACE_ROOT_MAX_CHARS } from "../../../rpc/project.js";
import { exactKeys, requireBoundedString, requireRecord } from "../../../rpc/validation.js";
import { parseProjectFollow } from "../../../rpc/project/validation.js";
import { parseTurnEvent } from "../../../rpc/content/validation.js";
import type { DesktopProjectEvent, DesktopProjectStreamHandle } from "../project.js";
import type {
  DesktopBridgeFailureCode,
  DesktopProjectFailure,
  DesktopProjectFailureCode,
  DesktopProjectResult,
} from "../project.js";

export const DESKTOP_PROJECT_FAILURE_MESSAGE_MAX_CHARS = 2_048;

const PROJECT_FAILURE_CODES: readonly ProjectFailureCode[] = [
  "invalid-request",
  "project-not-found",
  "node-not-found",
  "project-unavailable",
  "turn-active",
  "invalid-state",
  "revision-conflict",
  "workspace-conflict",
  "workspace-invalid",
  "runtime-unavailable",
  "auto-run-active",
  "auto-run-not-found",
  "auto-run-not-paused",
  "auto-run-unavailable",
  "internal",
];

const BRIDGE_FAILURE_CODES: readonly DesktopBridgeFailureCode[] = [
  "cancelled",
  "host-unavailable",
  "invalid-input",
  "invalid-output",
  "bridge-closed",
];

export function isProjectFailureCode(value: unknown): value is ProjectFailureCode {
  return (PROJECT_FAILURE_CODES as readonly unknown[]).includes(value);
}

export function parseDesktopProjectResult<T>(
  value: unknown,
  parseValue: (value: unknown) => T,
): DesktopProjectResult<T> {
  const result = requireRecord(value, "desktop project result");
  if (result.type === "ok" && exactKeys(result, ["type", "value"])) {
    return { type: "ok", value: parseValue(result.value) };
  }
  if (result.type === "failed" && exactKeys(result, ["type", "failure"])) {
    return { type: "failed", failure: parseDesktopProjectFailure(result.failure) };
  }
  throw new Error("Malformed desktop project result");
}

export function parseWorkspaceChoice(value: unknown): string | null {
  if (value === null) return null;
  const path = requireBoundedString(value, "workspace path", PROJECT_WORKSPACE_ROOT_MAX_CHARS);
  if (!path.trim()) throw new Error("Workspace path must not be blank");
  return path;
}

export function parseDesktopProjectHandle(value: unknown): DesktopProjectStreamHandle {
  const record = requireRecord(value, "desktop project stream handle");
  if (!exactKeys(record, ["subscriptionId"])) throw new Error("Malformed desktop project stream handle");
  return { subscriptionId: requireBoundedString(record.subscriptionId, "subscriptionId", 128) };
}

export function parseDesktopProjectNull(value: unknown): null {
  if (value !== null) throw new Error("Malformed desktop project null result");
  return null;
}

export function parseDesktopProjectEvent(value: unknown): DesktopProjectEvent {
  const event = requireRecord(value, "desktop project event");
  const type = event.type;
  if (type === "turn-event" && exactKeys(event, ["type", "operationId", "projectId", "event"])) {
    const parsed = parseTurnEvent(event.event);
    if ("commandId" in parsed) throw new Error("Project turn event must not be a command");
    return { type, operationId: parseOperationId(event.operationId), projectId: parseProjectId(event.projectId), event: parsed };
  }
  if ((type === "turn-error" || type === "follow-error") && exactKeys(event, ["type", "operationId", "projectId", "failure"])) {
    return { type, operationId: parseOperationId(event.operationId), projectId: parseProjectId(event.projectId), failure: parseDesktopProjectFailure(event.failure) };
  }
  if (type === "follow-snapshot" && exactKeys(event, ["type", "operationId", "projectId", "snapshot"])) {
    return { type, operationId: parseOperationId(event.operationId), projectId: parseProjectId(event.projectId), snapshot: parseProjectFollow(event.snapshot) };
  }
  throw new Error("Malformed desktop project event");
}

function parseOperationId(value: unknown): string { return requireBoundedString(value, "operationId", 128); }
function parseProjectId(value: unknown): string {
  const id = requireBoundedString(value, "projectId", 128);
  if (!id.trim()) throw new Error("Project id must not be blank");
  return id;
}

function parseDesktopProjectFailure(value: unknown): DesktopProjectFailure {
  const failure = requireRecord(value, "desktop project failure");
  if (!exactKeys(failure, ["code", "message"])) throw new Error("Malformed desktop project failure");
  return {
    code: parseFailureCode(failure.code),
    message: requireBoundedString(failure.message, "failure message", DESKTOP_PROJECT_FAILURE_MESSAGE_MAX_CHARS),
  };
}

function parseFailureCode(value: unknown): DesktopProjectFailureCode {
  if (isProjectFailureCode(value) || (BRIDGE_FAILURE_CODES as readonly unknown[]).includes(value)) {
    return value as DesktopProjectFailureCode;
  }
  throw new Error("Unknown desktop project failure code");
}
