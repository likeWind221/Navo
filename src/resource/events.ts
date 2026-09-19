import type {
  EventId,
  NodeId,
  ProjectId,
  ResourceId,
} from "../brand/ids.js";

export interface ResourceRegisteredEvent {
  readonly version: 1;
  readonly id: EventId;
  readonly projectId: ProjectId;
  readonly resourceId: ResourceId;
  readonly sequence: number;
  readonly timestamp: string;
  readonly type: "resource-registered";
  readonly data: {
    readonly sourceNodeId: NodeId;
    readonly title: string;
    readonly description: string;
    readonly resourceType: string;
    readonly ref: string;
  };
}

export type ResourceEvent = ResourceRegisteredEvent;
