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
import { normalizeLibraryPath, libraryPathKey } from "./library.js";
import { validateVersionEntryRef } from "./path.js";
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
  type ResourceHistoryContext,
  validateResourceMetadata,
  validateResourcePatch,
} from "./validation.js";

export function parseResourceHistory(
  ctx: ResourceHistoryContext,
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
    const updated = states.get(event.resourceId)!;
    if (updated.status === "active" && [...states.values()].some(state => {
      if (state === updated || state.status !== "active") return false;
      const other = libraryPathKey(state.resource.libraryPath);
      const path = libraryPathKey(updated.resource.libraryPath);
      return other === path || other.startsWith(`${path}/`) || path.startsWith(`${other}/`);
    })) throw invalidHistory();
  }
  return Object.freeze(events);
}

function parseResourceEvent(
  ctx: ResourceHistoryContext,
  projectId: ProjectId,
  raw: unknown,
  sequence: number,
  states: ReadonlyMap<ResourceId, ResourceState>,
): ResourceEvent {
  if (raw === null || typeof raw !== "object") throw invalidHistory();
  const value = raw as Record<string, unknown>;
  if (
    value.version !== 4
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
    version: 4 as const,
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
    if (typeof data.operationId !== "string" || data.assetGeneration !== 1) throw invalidHistory();
    const libraryPath = normalizeLibraryPath(data.libraryPath);
    if ([...states.values()].some(state => state.status === "active" && libraryPathKey(state.resource.libraryPath) === libraryPathKey(libraryPath))) throw invalidHistory();
    const owner = parseHistoryPrincipal(data.owner);
    requireResourcePrincipal(ctx, projectId, owner, "invalid-history");
    const access = data.access === undefined ? undefined : parseHistoryAccess(data.access, owner);
    if (access !== undefined) requireResourceAccessNodes(ctx, projectId, access, "invalid-history");
    const metadata = validateCreatedMetadata(data);
    validateVersionEntryRef(metadata.entryRef, 1);
    return freezeResourceEvent({
      ...header,
      type: "resource-created",
      data: {
        owner,
        ...(access === undefined ? {} : { access }),
        name: metadata.name,
        description: metadata.description,
        resourceType: metadata.type,
        entryRef: metadata.entryRef,
        libraryPath,
        assetGeneration: 1,
        operationId: data.operationId,
      },
    });
  }

  const current = states.get(resourceId);
  if (current === undefined || current.status !== "active") throw invalidHistory();

  if (value.type === "resource-replaced") {
    if (typeof data.operationId !== "string" || data.assetGeneration !== current.resource.assetGeneration + 1) throw invalidHistory();
    return freezeResourceEvent({ ...header, type: "resource-replaced", data: {
      entryRef: validateVersionEntryRef(data.entryRef, data.assetGeneration as number), assetGeneration: data.assetGeneration as number, operationId: data.operationId } });
  }

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

  if (value.type === "resource-organized") {
    const libraryPath = normalizeLibraryPath(data.libraryPath);
    if (data.name !== undefined && (typeof data.name !== "string" || normalizeLibraryPath(data.name).includes("/"))) throw invalidHistory();
    return freezeResourceEvent({ ...header, type: "resource-organized", data: {
      libraryPath, ...(data.name === undefined ? {} : { name: data.name as string }),
    } });
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
    && typeof data.operationId === "string"
  ) {
    return freezeResourceEvent({
      ...header,
      type: "resource-deleted",
      data: { operationId: data.operationId as string },
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
    if (principal.kind === "user" && Object.keys(principal).length === 1) {
      return normalizeResourcePrincipal({ kind: "user" });
    }
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
    if (access.kind === "public" && Object.keys(access).length === 1) {
      return normalizeResourceAccess({ kind: "public" }, owner);
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
