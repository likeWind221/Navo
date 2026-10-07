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

export const RESOURCE_ID_PARAMETER: JsonObject = {
  type: "string",
  description: "Resource ID as listed in available-resources or returned by a Resource tool. A Resource name is accepted only when exactly one visible Resource has it.",
};

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

export function resolveResourceRef(
  ctx: Context,
  caller: ResourceToolCaller,
  value: JsonValue | undefined,
): ResourceId {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalidResourceTool("resource_id must be a non-empty string.");
  }
  const visible = ctx.resources.listVisible(caller.projectId, caller.principal);
  if (visible.some(resource => resource.id === value)) return createResourceId(value);
  const named = visible.filter(resource => nameKey(resource.name) === nameKey(value));
  if (named.length === 1) return named[0]!.id;
  if (named.length > 1) {
    throw invalidResourceTool(
      `'${value}' matches several Resource names; use one of these Resource IDs: ${named.map(resource => resource.id).join(", ")}.`,
    );
  }
  return createResourceId(value);
}

export function withVisibleResourceRefs(
  ctx: Context,
  parameters: JsonObject,
  sessionId: SessionId,
): JsonObject {
  const caller = requireResourceToolCaller(ctx, sessionId);
  const visible = ctx.resources.listVisible(caller.projectId, caller.principal);
  const counts = new Map<string, number>();
  for (const resource of visible) {
    counts.set(nameKey(resource.name), (counts.get(nameKey(resource.name)) ?? 0) + 1);
  }
  const refs = [...new Set([
    ...visible.map(resource => String(resource.id)),
    ...visible.filter(resource => counts.get(nameKey(resource.name)) === 1).map(resource => resource.name),
  ])];
  if (refs.length === 0) return parameters;
  const properties = parameters.properties as JsonObject;
  return {
    ...parameters,
    properties: {
      ...properties,
      resource_id: { ...(properties.resource_id as JsonObject), enum: refs },
    },
  };
}

function nameKey(value: string): string {
  return value.trim().toLowerCase();
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
      return `The Resource content is unavailable or violates its file boundary: ${error.message}`;
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
