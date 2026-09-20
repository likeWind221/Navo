import type { Context } from "cordis";

import {
  createEventId,
  createNodeId,
  createResourceId,
} from "../brand/ids.js";
import type {
  ProjectId,
  ResourceId,
} from "../brand/ids.js";
import {
  normalizeResourceAccess,
  normalizeResourcePrincipal,
} from "./access.js";
import { ResourceError } from "./errors.js";
import type { ResourceEvent } from "./events.js";
import { freezeResourceEvent } from "./events.js";
import type {
  ResourceAccess,
  ResourceMetadataPatch,
  ResourcePrincipal,
} from "./model.js";
import {
  projectResourceEvent,
  type ResourceState,
} from "./projector.js";
import {
  requireResourceAccessNodes,
  requireResourcePrincipal,
  validateResourceMetadata,
  validateResourcePatch,
} from "./validation.js";

export function parseResourceHistory(
  ctx: Context,
  projectId: ProjectId,
  history: readonly unknown[],
): readonly ResourceEvent[] {
  const events: ResourceEvent[] = [];
  const states = new Map<ResourceId, ResourceState>();

  for (let index = 0; index < history.length; index += 1) {
    const event = parseResourceEvent(
      ctx,
      projectId,
      history[index],
      index + 1,
      states,
    );
    events.push(event);
    states.set(
      event.resourceId,
      projectResourceEvent(states.get(event.resourceId), event),
    );
  }
  return Object.freeze(events);
}

function parseResourceEvent(
  ctx: Context,
  projectId: ProjectId,
  raw: unknown,
  sequence: number,
  states: ReadonlyMap<ResourceId, ResourceState>,
): ResourceEvent {
  if (raw === null || typeof raw !== "object") throw invalidHistory();
  const value = raw as Record<string, unknown>;
  if (
    value.version !== 3
    || typeof value.id !== "string"
    || value.projectId !== projectId
    || typeof value.resourceId !== "string"
    || value.sequence !== sequence
    || !Number.isSafeInteger(value.revision)
    || !Number.isSafeInteger(value.baseRevision)
    || typeof value.timestamp !== "string"
    || Number.isNaN(Date.parse(value.timestamp))
    || value.data === null
    || typeof value.data !== "object"
  ) {
    throw invalidHistory();
  }

  const resourceId = createResourceId(value.resourceId);
  const header = {
    version: 3 as const,
    id: createEventId(value.id),
    projectId,
    resourceId,
    sequence,
    revision: value.revision as number,
    baseRevision: value.baseRevision as number,
    timestamp: value.timestamp,
  };
  const data = value.data as Record<string, unknown>;

  if (value.type === "resource-created") {
    const owner = parseHistoryPrincipal(data.owner);
    requireResourcePrincipal(ctx, projectId, owner, "invalid-history");
    const metadata = validateCreatedMetadata(data);
    return freezeResourceEvent({
      ...header,
      type: "resource-created",
      data: {
        owner,
        name: metadata.name,
        description: metadata.description,
        resourceType: metadata.type,
        entryRef: metadata.entryRef,
      },
    });
  }

  const current = states.get(resourceId);
  if (current === undefined || current.status !== "active") throw invalidHistory();

  if (value.type === "resource-updated") {
    if (data.changes === null || typeof data.changes !== "object") throw invalidHistory();
    const changes = validateResourcePatch(
      data.changes as ResourceMetadataPatch,
      "invalid-history",
    );
    return freezeResourceEvent({
      ...header,
      type: "resource-updated",
      data: { changes },
    });
  }

  if (value.type === "resource-access-changed") {
    const access = parseHistoryAccess(data.access, current.resource.owner);
    requireResourceAccessNodes(ctx, projectId, access, "invalid-history");
    return freezeResourceEvent({
      ...header,
      type: "resource-access-changed",
      data: { access },
    });
  }

  if (
    value.type === "resource-deleted"
    && Object.keys(data).length === 0
  ) {
    return freezeResourceEvent({
      ...header,
      type: "resource-deleted",
      data: {},
    });
  }

  throw invalidHistory();
}

function validateCreatedMetadata(data: Record<string, unknown>) {
  try {
    return validateResourceMetadata({
      name: data.name,
      description: data.description,
      type: data.resourceType,
      entryRef: data.entryRef,
    });
  } catch (error: unknown) {
    throw new ResourceError(
      "invalid-history",
      "Resource history contains invalid metadata.",
      { cause: error },
    );
  }
}

function parseHistoryPrincipal(value: unknown): ResourcePrincipal {
  if (value === null || typeof value !== "object") throw invalidHistory();
  const principal = value as Record<string, unknown>;
  try {
    if (principal.kind === "main" && Object.keys(principal).length === 1) {
      return normalizeResourcePrincipal({ kind: "main" });
    }
    if (
      principal.kind === "node"
      && Object.keys(principal).length === 2
      && typeof principal.nodeId === "string"
    ) {
      return normalizeResourcePrincipal({
        kind: "node",
        nodeId: createNodeId(principal.nodeId),
      });
    }
  } catch (error: unknown) {
    throw new ResourceError(
      "invalid-history",
      "Resource history contains an invalid owner.",
      { cause: error },
    );
  }
  throw invalidHistory();
}

function parseHistoryAccess(
  value: unknown,
  owner: ResourcePrincipal,
): ResourceAccess {
  if (value === null || typeof value !== "object") throw invalidHistory();
  const access = value as Record<string, unknown>;
  try {
    if (access.kind === "private" && Object.keys(access).length === 1) {
      return normalizeResourceAccess({ kind: "private" }, owner);
    }
    if (access.kind === "project" && Object.keys(access).length === 1) {
      return normalizeResourceAccess({ kind: "project" }, owner);
    }
    if (
      access.kind === "shared"
      && Object.keys(access).length === 2
      && Array.isArray(access.nodeIds)
      && access.nodeIds.every(nodeId => typeof nodeId === "string")
    ) {
      return normalizeResourceAccess({
        kind: "shared",
        nodeIds: access.nodeIds.map(nodeId => createNodeId(nodeId as string)),
      }, owner);
    }
  } catch (error: unknown) {
    throw new ResourceError(
      "invalid-history",
      "Resource history contains invalid access.",
      { cause: error },
    );
  }
  throw invalidHistory();
}

function invalidHistory(): ResourceError {
  return new ResourceError(
    "invalid-history",
    "Resource history contains an invalid event.",
  );
}
