import type { NodeId, ProjectId, ResourceId } from "../brand/ids.js";

export interface ProjectResource {
  readonly id: ResourceId;
  readonly projectId: ProjectId;
  readonly sourceNodeId: NodeId;
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly entryRef: string;
  readonly access: ResourceAccess;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ResourceAccess =
  | { readonly kind: "private" }
  | { readonly kind: "shared"; readonly nodeIds: readonly NodeId[] }
  | { readonly kind: "project" };

export type ResourceViewer =
  | { readonly kind: "main" }
  | { readonly kind: "node"; readonly nodeId: NodeId };

export interface CreateResourceInput {
  readonly projectId: ProjectId;
  readonly sourceNodeId: NodeId;
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly entryRef: string;
}

export interface ResourceMetadataPatch {
  readonly name?: string;
  readonly description?: string;
  readonly type?: string;
  readonly entryRef?: string;
}

export interface UpdateResourceInput {
  readonly projectId: ProjectId;
  readonly resourceId: ResourceId;
  readonly expectedRevision: number;
  readonly changes: ResourceMetadataPatch;
}

export interface SetResourceAccessInput {
  readonly projectId: ProjectId;
  readonly resourceId: ResourceId;
  readonly expectedRevision: number;
  readonly access: ResourceAccess;
}

export interface DeleteResourceInput {
  readonly projectId: ProjectId;
  readonly resourceId: ResourceId;
  readonly expectedRevision: number;
}

export interface ResourceEntryTarget {
  readonly resourceId: ResourceId;
  readonly path: string;
}
