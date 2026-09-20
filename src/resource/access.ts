import { createNodeId } from "../brand/ids.js";
import { ResourceError } from "./errors.js";
import type {
  ProjectResource,
  ResourceAccess,
  ResourcePrincipal,
} from "./model.js";

export function normalizeResourcePrincipal(
  value: ResourcePrincipal,
): ResourcePrincipal {
  if (value.kind === "main") return Object.freeze({ kind: "main" });
  if (value.kind === "node") {
    return Object.freeze({
      kind: "node",
      nodeId: createNodeId(value.nodeId),
    });
  }
  throw new ResourceError("invalid-resource", "Resource owner is invalid.");
}

export function sameResourcePrincipal(
  left: ResourcePrincipal,
  right: ResourcePrincipal,
): boolean {
  if (left.kind !== right.kind) return false;
  return left.kind === "main"
    || (right.kind === "node" && left.nodeId === right.nodeId);
}

export function normalizeResourceAccess(
  value: ResourceAccess,
  owner: ResourcePrincipal,
): ResourceAccess {
  if (value.kind === "private") return Object.freeze({ kind: "private" });
  if (value.kind === "project") return Object.freeze({ kind: "project" });
  if (value.kind !== "shared" || !Array.isArray(value.nodeIds) || value.nodeIds.length === 0) {
    throw new ResourceError(
      "invalid-access",
      "Shared Resource access requires at least one Node.",
    );
  }

  const nodeIds = value.nodeIds.map(nodeId => createNodeId(nodeId));
  if (
    owner.kind === "node"
    && nodeIds.some(nodeId => nodeId === owner.nodeId)
  ) {
    throw new ResourceError(
      "invalid-access",
      "Resource owner is implicit and must not appear in shared access.",
    );
  }
  const unique = [...new Set(nodeIds)].sort();
  if (unique.length !== nodeIds.length) {
    throw new ResourceError(
      "invalid-access",
      "Shared Resource access cannot contain duplicate Nodes.",
    );
  }
  return Object.freeze({
    kind: "shared",
    nodeIds: Object.freeze(unique),
  });
}

export function sameResourceAccess(
  left: ResourceAccess,
  right: ResourceAccess,
): boolean {
  if (left.kind !== right.kind) return false;
  if (left.kind !== "shared" || right.kind !== "shared") return true;
  return left.nodeIds.length === right.nodeIds.length
    && left.nodeIds.every((nodeId, index) => nodeId === right.nodeIds[index]);
}

export function canReadResource(
  resource: ProjectResource,
  viewer: ResourcePrincipal,
): boolean {
  if (viewer.kind === "main") return true;
  if (sameResourcePrincipal(resource.owner, viewer)) return true;
  if (resource.access.kind === "project") return true;
  if (resource.access.kind === "private") return false;
  return resource.access.nodeIds.includes(viewer.nodeId);
}
