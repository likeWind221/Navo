import type { ProjectFailureCode } from "../../../rpc/project.js";
import { PROJECT_WORKSPACE_ROOT_MAX_CHARS } from "../../../rpc/project.js";
import { exactKeys, requireBoundedString, requireRecord } from "../../../rpc/validation.js";
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
  "internal",
];

const BRIDGE_FAILURE_CODES: readonly DesktopBridgeFailureCode[] = [
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
