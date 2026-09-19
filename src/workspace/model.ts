import type { ProjectId } from "../brand/ids.js";

/**
 * Host-side physical Workspace projection. Absolute paths are execution details;
 * durable Resource identity must use Project-relative refs instead.
 */
export interface ProjectWorkspace {
  readonly projectId: ProjectId;
  readonly root: string;
  readonly assetsRoot: string;
  readonly nodesRoot: string;
}

export interface WorkspaceTarget {
  readonly projectId: ProjectId;
  readonly ref: string;
  readonly path: string;
  readonly exists: boolean;
}

export const PROJECT_ASSETS_REF = "assets";
export const PROJECT_NODES_REF = "nodes";
