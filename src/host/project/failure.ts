import { RpcError } from "../../../rpc/errors.js";
import type { ProjectFailureCode } from "../../../rpc/project.js";
import { NodeError } from "../../node/errors.js";
import type { NodeErrorCode } from "../../node/errors.js";
import { ProjectError } from "../../project/errors.js";
import type { ProjectErrorCode } from "../../project/errors.js";
import { WorkspaceError } from "../../workspace/errors.js";
import type { WorkspaceErrorCode } from "../../workspace/errors.js";

const projectCodes: Partial<Record<ProjectErrorCode, ProjectFailureCode>> = {
  "project-not-found": "project-not-found",
  "project-unavailable": "project-unavailable",
  "turn-active": "turn-active",
  "runtime-unavailable": "runtime-unavailable",
  "invalid-event-stream": "invalid-request",
  "invalid-message": "invalid-request",
};

const nodeCodes: Partial<Record<NodeErrorCode, ProjectFailureCode>> = {
  "node-not-found": "node-not-found",
  "project-unavailable": "project-unavailable",
  "invalid-state": "invalid-state",
  "node-already-bound": "invalid-state",
  "node-session-required": "invalid-state",
  "stale-revision": "revision-conflict",
  "invalid-message": "invalid-request",
  "node-session-service-unavailable": "runtime-unavailable",
  "node-context-unavailable": "runtime-unavailable",
};

const workspaceCodes: Partial<Record<WorkspaceErrorCode, ProjectFailureCode>> = {
  "project-not-found": "project-not-found",
  "workspace-conflict": "workspace-conflict",
  "invalid-config": "workspace-invalid",
  "path-not-allowed": "workspace-invalid",
  "not-found": "workspace-invalid",
  "not-a-directory": "workspace-invalid",
  "permission-denied": "workspace-invalid",
};

export function toProjectFailure(error: unknown): RpcError {
  const code = error instanceof ProjectError ? projectCodes[error.code]
    : error instanceof NodeError ? nodeCodes[error.code]
      : error instanceof WorkspaceError ? workspaceCodes[error.code]
        : undefined;
  if (code === undefined || !(error instanceof Error)) {
    process.stderr.write(`[kernel-host] project method failed: ${describe(error)}\n`);
    return projectFailure("internal", "Project operation failed.");
  }
  return projectFailure(code, error.message);
}

export function projectFailure(code: ProjectFailureCode, message: string): RpcError {
  return new RpcError("remote-error", message, { failure: { code, message, details: {} } });
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "Unknown failure";
}
