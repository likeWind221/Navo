import type { ProjectId } from "../brand/ids.js";
import { ResourceError } from "./errors.js";
import type { ResourceEvent } from "./events.js";
import type { ProjectResource, ResourceAccess } from "./model.js";

export type ResourceState =
  | { readonly status: "active"; readonly resource: ProjectResource }
  | {
      readonly status: "deleted";
      readonly resource: ProjectResource;
      readonly deletedAt: string;
    };

export function projectResourceEvent(
  current: ResourceState | undefined,
  event: ResourceEvent,
): ResourceState {
  if (event.type === "resource-created") {
    if (current !== undefined || event.baseRevision !== 0 || event.revision !== 1) {
      throw invalidHistory();
    }
    return Object.freeze({
      status: "active",
      resource: freezeResource({
        id: event.resourceId,
        projectId: event.projectId,
        sourceNodeId: event.data.sourceNodeId,
        name: event.data.name,
        description: event.data.description,
        type: event.data.resourceType,
        entryRef: event.data.entryRef,
        access: { kind: "private" },
        revision: 1,
        createdAt: event.timestamp,
        updatedAt: event.timestamp,
      }),
    });
  }

  if (
    current === undefined
    || current.status !== "active"
    || current.resource.projectId !== event.projectId
    || current.resource.id !== event.resourceId
    || event.baseRevision !== current.resource.revision
    || event.revision !== current.resource.revision + 1
  ) {
    throw invalidHistory();
  }

  if (event.type === "resource-updated") {
    return Object.freeze({
      status: "active",
      resource: freezeResource({
        ...current.resource,
        ...event.data.changes,
        revision: event.revision,
        updatedAt: event.timestamp,
      }),
    });
  }

  if (event.type === "resource-access-changed") {
    return Object.freeze({
      status: "active",
      resource: freezeResource({
        ...current.resource,
        access: event.data.access,
        revision: event.revision,
        updatedAt: event.timestamp,
      }),
    });
  }

  return Object.freeze({
    status: "deleted",
    resource: freezeResource({
      ...current.resource,
      revision: event.revision,
      updatedAt: event.timestamp,
    }),
    deletedAt: event.timestamp,
  });
}

export function projectResourceHistory(
  projectId: ProjectId,
  events: readonly ResourceEvent[],
): ReadonlyMap<string, ResourceState> {
  const states = new Map<string, ResourceState>();
  for (const event of events) {
    if (event.projectId !== projectId) throw invalidHistory();
    states.set(event.resourceId, projectResourceEvent(states.get(event.resourceId), event));
  }
  return states;
}

function freezeResource(resource: ProjectResource): ProjectResource {
  return Object.freeze({
    ...resource,
    access: freezeAccess(resource.access),
  });
}

function freezeAccess(access: ResourceAccess): ResourceAccess {
  if (access.kind !== "shared") return Object.freeze({ ...access });
  return Object.freeze({
    kind: "shared",
    nodeIds: Object.freeze([...access.nodeIds]),
  });
}

function invalidHistory(): ResourceError {
  return new ResourceError(
    "invalid-history",
    "Resource event stream contains an invalid lifecycle transition.",
  );
}
