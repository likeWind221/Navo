import type { Context } from "cordis";

import { createResourceId } from "../../../brand/ids.js";
import type {
  ResourceId,
  SessionId,
} from "../../../brand/ids.js";
import type { JsonObject, JsonValue } from "../../../llm/types.js";
import {
  AgentBindingError,
  requireAgentBinding,
} from "../../../project/binding.js";
import { ResourceError } from "../../../resource/errors.js";
import { FileError } from "../file/errors.js";
import type {
  ProjectResource,
  ResourcePrincipal,
} from "../../../resource/model.js";
import { ToolExecutionError } from "../../errors.js";

export interface ResourceToolCaller {
  readonly projectId: ProjectResource["projectId"];
  readonly principal: ResourcePrincipal;
}

export function requireResourceToolCaller(
  ctx: Context,
  sessionId: SessionId | undefined,
): ResourceToolCaller {
  const binding = requireAgentBinding(ctx, sessionId);
  return Object.freeze({
    projectId: binding.projectId,
    principal: binding.kind === "main"
      ? Object.freeze({ kind: "main" as const })
      : Object.freeze({ kind: "node" as const, nodeId: binding.nodeId }),
  });
}

export function resourceId(value: JsonValue | undefined): ResourceId {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidResourceTool("resource_id must be a non-empty string.");
  }
  return createResourceId(value);
}

export function positiveRevision(
  value: JsonValue | undefined,
): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw invalidResourceTool("expected_revision must be a positive safe integer.");
  }
  return value;
}

export function optionalText(
  value: JsonValue | undefined,
  field: string,
): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidResourceTool(`${field} must be a non-empty string when provided.`);
  }
  return value;
}

export function resourceArtifact(
  resource: ProjectResource,
): JsonObject {
  return {
    resource_id: String(resource.id),
    project_id: String(resource.projectId),
    owner: resource.owner.kind === "main"
      ? { kind: "main" }
      : { kind: "node", node_id: String(resource.owner.nodeId) },
    name: resource.name,
    description: resource.description,
    type: resource.type,
    access: resource.access.kind === "shared"
      ? {
          kind: "shared",
          node_ids: resource.access.nodeIds.map(String),
        }
      : { kind: resource.access.kind },
    revision: resource.revision,
  };
}

export function resourceToolFailure(error: unknown): never {
  if (error instanceof ToolExecutionError) throw error;
  if (error instanceof AgentBindingError) {
    throw new ToolExecutionError(
      error.message,
      "This Resource capability requires the current Main or Node Agent Session.",
      { cause: error },
    );
  }
  if (error instanceof FileError) {
    throw new ToolExecutionError(error.message, error.modelMessage, { cause: error });
  }
  if (error instanceof ResourceError) {
    throw new ToolExecutionError(
      error.message,
      resourceErrorMessage(error),
      { cause: error },
    );
  }
  if (error instanceof Error) {
    throw new ToolExecutionError(
      error.message,
      "The Resource operation failed.",
      { cause: error },
    );
  }
  throw new ToolExecutionError(
    "Unknown Resource capability failure.",
    "The Resource operation failed.",
  );
}

export function invalidResourceTool(message: string): ToolExecutionError {
  return new ToolExecutionError(
    `Invalid Resource tool request: ${message}`,
    `The Resource request is invalid: ${message}`,
  );
}

function resourceErrorMessage(error: ResourceError): string {
  switch (error.code) {
    case "resource-not-owned":
      return "Only the Resource owner may update or delete it. Resources shared with you are read-only.";
    case "stale-revision":
      return "The Resource changed since the version you read. Fetch it again and retry with the current revision.";
    case "resource-unavailable":
      return "The Resource is unavailable in the current Project or you do not have permission to read it.";
    case "resource-content-unavailable":
      return "The Resource content is unavailable or violates its file boundary.";
    case "project-unavailable":
      return "The Resource operation requires the current Project to be active.";
    case "workspace-unavailable":
      return "The current Project has no bound Workspace.";
    case "node-unavailable":
      return "The current Node is not a valid work Node in this Project.";
    case "invalid-resource":
      return `The Resource request is invalid: ${error.message}`;
    case "invalid-access":
      return "The requested Resource access change is not allowed.";
    default:
      return "The Resource operation was rejected by the Project Resource domain.";
  }
}
