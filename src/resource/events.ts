import { randomUUID } from "node:crypto";

import { createEventId } from "../brand/ids.js";
import type {
  EventId,
  ProjectId,
  ResourceId,
} from "../brand/ids.js";
import type {
  ResourceAccess,
  ResourceMetadataPatch,
  ResourcePrincipal,
} from "./model.js";

export type ResourceEvent = ResourceEventHeader & (
  | {
      readonly type: "resource-created";
      readonly data: {
        readonly owner: ResourcePrincipal;
        readonly name: string;
        readonly description: string;
        readonly resourceType: string;
        readonly entryRef: string;
      };
    }
  | {
      readonly type: "resource-updated";
      readonly data: { readonly changes: ResourceMetadataPatch };
    }
  | {
      readonly type: "resource-access-changed";
      readonly data: { readonly access: ResourceAccess };
    }
  | {
      readonly type: "resource-deleted";
      readonly data: Record<string, never>;
    }
);

export interface ResourceEventHeader {
  readonly version: 3;
  readonly id: EventId;
  readonly projectId: ProjectId;
  readonly resourceId: ResourceId;
  readonly sequence: number;
  readonly revision: number;
  readonly baseRevision: number;
  readonly timestamp: string;
}

export function createResourceEvent(input: {
  readonly projectId: ProjectId;
  readonly resourceId: ResourceId;
  readonly sequence: number;
  readonly baseRevision: number;
  readonly type: ResourceEvent["type"];
  readonly data: ResourceEvent["data"];
}): ResourceEvent {
  return freezeResourceEvent({
    version: 3,
    id: createEventId(randomUUID()),
    projectId: input.projectId,
    resourceId: input.resourceId,
    sequence: input.sequence,
    revision: input.baseRevision + 1,
    baseRevision: input.baseRevision,
    timestamp: new Date().toISOString(),
    type: input.type,
    data: input.data,
  } as ResourceEvent);
}

export function freezeResourceEvent(event: ResourceEvent): ResourceEvent {
  return deepFreeze(structuredClone(event));
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
