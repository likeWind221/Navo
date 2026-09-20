import type { NodeId, ProjectId, ResourceId } from "../brand/ids.js";

export interface ProjectResource {
  readonly id: ResourceId;
  readonly projectId: ProjectId;
  readonly owner: ResourcePrincipal;
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly entryRef: string;
  readonly access: ResourceAccess;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ResourcePrincipal =
  | { readonly kind: "main" }
  | { readonly kind: "node"; readonly nodeId: NodeId };

export type ResourceAccess =
  | { readonly kind: "private" }
  | { readonly kind: "shared"; readonly nodeIds: readonly NodeId[] }
  | { readonly kind: "project" };

export interface CreateResourceInput {
  readonly projectId: ProjectId;
  readonly owner: ResourcePrincipal;
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly entryRef: string;
}

export interface PublishResourceInput {
  readonly projectId: ProjectId;
  readonly owner: ResourcePrincipal;
  readonly sourceRef: string;
  readonly name: string;
  readonly description: string;
  readonly type: string;
}

export interface ResourceMetadataPatch {
  readonly name?: string;
  readonly description?: string;
  readonly type?: string;
  readonly entryRef?: string;
}

export interface UpdateResourceInput {
  readonly projectId: ProjectId;
  readonly actor: ResourcePrincipal;
  readonly resourceId: ResourceId;
  readonly expectedRevision: number;
  readonly changes: ResourceMetadataPatch;
}

export interface SetResourceAccessInput {
  readonly projectId: ProjectId;
  readonly actor: ResourcePrincipal;
  readonly resourceId: ResourceId;
  readonly expectedRevision: number;
  readonly access: ResourceAccess;
}

export interface DeleteResourceInput {
  readonly projectId: ProjectId;
  readonly actor: ResourcePrincipal;
  readonly resourceId: ResourceId;
  readonly expectedRevision: number;
}

export interface ResourceEntryTarget {
  readonly resourceId: ResourceId;
  readonly root: string;
  readonly path: string;
}
