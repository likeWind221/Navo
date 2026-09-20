import type { ProjectId } from "../brand/ids.js";

export interface ProjectWorkspace {
  readonly projectId: ProjectId;
  readonly root: string;
  readonly navoRoot: string;
  readonly assetsRoot: string;
  readonly nodesRoot: string;
  readonly skillsRoot: string;
}

export interface WorkspaceTarget {
  readonly projectId: ProjectId;
  readonly ref: string;
  readonly path: string;
  readonly exists: boolean;
}

export const NAVO_INTERNAL_REF = ".navo";
export const PROJECT_ASSETS_REF = "assets";
export const PROJECT_NODES_REF = "nodes";
export const PROJECT_SKILLS_REF = "skills";
