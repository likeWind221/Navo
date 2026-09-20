import type {
  EventId,
  NodeId,
  ProjectId,
  ResourceId,
} from "../brand/ids.js";
import type {
  ResourceAccess,
  ResourceMetadataPatch,
} from "./model.js";

export type ResourceEvent = ResourceEventHeader & (
  | {
      readonly type: "resource-created";
      readonly data: {
        readonly sourceNodeId: NodeId;
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
  readonly version: 2;
  readonly id: EventId;
  readonly projectId: ProjectId;
  readonly resourceId: ResourceId;
  readonly sequence: number;
  readonly revision: number;
  readonly baseRevision: number;
  readonly timestamp: string;
}

export function freezeResourceEvent(event: ResourceEvent): ResourceEvent {
  return deepFreeze(structuredClone(event));
}

function deepFreeze<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  for (const child of Object.values(value)) deepFreeze(child);
  return Object.freeze(value);
}
