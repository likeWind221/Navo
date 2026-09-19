import type { NodeId, ProjectId, ResourceId } from "../brand/ids.js";

export interface ProjectResource {
  readonly id: ResourceId;
  readonly projectId: ProjectId;
  readonly sourceNodeId: NodeId;
  readonly sequence: number;
  readonly createdAt: string;
  readonly title: string;
  readonly description: string;
  readonly type: string;
  readonly ref: string;
}

export interface CreateResourceInput {
  readonly projectId: ProjectId;
  readonly sourceNodeId: NodeId;
  readonly title: string;
  readonly description: string;
  readonly type: string;
  readonly ref: string;
}
