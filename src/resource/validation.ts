import type { Context } from "cordis";

import type { NodeId, ProjectId } from "../brand/ids.js";
import { ResourceError } from "./errors.js";
import type {
  ProjectResource,
  ResourceAccess,
  ResourceMetadataPatch,
  ResourcePrincipal,
} from "./model.js";
import { validateResourceEntryRef } from "./path.js";

export function validateResourceMetadata(input: {
  readonly name: unknown;
  readonly description: unknown;
  readonly type: unknown;
  readonly entryRef: unknown;
}): {
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly entryRef: string;
} {
  return Object.freeze({
    name: requireResourceText(input.name, "name"),
    description: requireResourceText(input.description, "description"),
    type: requireResourceText(input.type, "type"),
    entryRef: validateResourceEntryRef(input.entryRef),
  });
}

export function validateResourcePatch(
  input: ResourceMetadataPatch,
  code: "invalid-resource" | "invalid-history" = "invalid-resource",
): ResourceMetadataPatch {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    throw new ResourceError(code, "Resource metadata patch is invalid.");
  }
  const keys = Object.keys(input);
  if (
    keys.length === 0
    || keys.some(key => !["name", "description", "type"].includes(key))
  ) {
    throw new ResourceError(code, "Resource metadata patch is invalid.");
  }

  try {
    return Object.freeze({
      ...(input.name === undefined
        ? {}
        : { name: requireResourceText(input.name, "name") }),
      ...(input.description === undefined
        ? {}
        : { description: requireResourceText(input.description, "description") }),
      ...(input.type === undefined
        ? {}
        : { type: requireResourceText(input.type, "type") }),
    });
  } catch (error: unknown) {
    if (code === "invalid-history") {
      throw new ResourceError(
        code,
        "Resource history contains invalid metadata.",
        { cause: error },
      );
    }
    throw error;
  }
}

export function effectiveResourceChanges(
  current: ProjectResource,
  changes: ResourceMetadataPatch,
): ResourceMetadataPatch {
  return Object.freeze({
    ...(changes.name !== undefined && changes.name !== current.name
      ? { name: changes.name }
      : {}),
    ...(changes.description !== undefined && changes.description !== current.description
      ? { description: changes.description }
      : {}),
    ...(changes.type !== undefined && changes.type !== current.type
      ? { type: changes.type }
      : {}),
  });
}

export function requireResourcePrincipal(
  ctx: Context,
  projectId: ProjectId,
  principal: ResourcePrincipal,
  code: "node-unavailable" | "invalid-history" | "invalid-access" = "node-unavailable",
): void {
  if (principal.kind === "main") return;
  requireResourceWorkNode(ctx, projectId, principal.nodeId, code);
}

export function requireResourceWorkNode(
  ctx: Context,
  projectId: ProjectId,
  nodeId: NodeId,
  code: "node-unavailable" | "invalid-history" | "invalid-access" = "node-unavailable",
): void {
  const node = ctx.nodes.get(nodeId);
  if (
    node !== undefined
    && node.node.projectId === projectId
    && node.node.kind === "work"
  ) {
    return;
  }
  throw new ResourceError(
    code,
    code === "node-unavailable"
      ? "Resource Node must be a work Node in the same Project."
      : "Resource history or access contains an unavailable Node.",
  );
}

export function requireResourceAccessNodes(
  ctx: Context,
  projectId: ProjectId,
  access: ResourceAccess,
  code: "invalid-access" | "invalid-history" = "invalid-access",
): void {
  if (access.kind !== "shared") return;
  for (const nodeId of access.nodeIds) {
    requireResourceWorkNode(ctx, projectId, nodeId, code);
  }
}

function requireResourceText(value: unknown, field: string): string {
  if (
    typeof value !== "string"
    || value.trim().length === 0
    || value.includes("\0")
  ) {
    throw new ResourceError(
      "invalid-resource",
      `Resource ${field} must be a non-empty string.`,
    );
  }
  return value;
}
