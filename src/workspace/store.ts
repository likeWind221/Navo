import { lstat, rm } from "node:fs/promises";
import { join } from "node:path";

import { Service } from "cordis";
import type { Context } from "cordis";

import type { ProjectId } from "../brand/ids.js";
import { WorkspaceError } from "./errors.js";
import {
  PROJECT_ASSETS_REF,
  PROJECT_NODES_REF,
} from "./model.js";
import type {
  ProjectWorkspace,
  WorkspaceTarget,
} from "./model.js";
import {
  assertContained,
  canonicalBaseRoot,
  classifyWorkspaceIoError,
  ensureOwnedDirectory,
  isCode,
  projectDirectoryName,
  resolveWorkspaceTarget,
  validateWorkspaceBaseRoot,
} from "./path.js";

export interface ProjectWorkspaceConfig {
  readonly root: string;
}

export class ProjectWorkspaceStore extends Service {
  static inject = ["projects"];

  private readonly configuredRoot: string;
  private projectsRootPromise: Promise<string> | undefined;

  constructor(ctx: Context, config: ProjectWorkspaceConfig) {
    super(ctx, "projectWorkspaces");
    this.configuredRoot = validateWorkspaceBaseRoot(config?.root);
  }

  async create(projectId: ProjectId): Promise<ProjectWorkspace> {
    this.requireProject(projectId);
    const projectsRoot = await this.projectsRoot();
    const projectRoot = await ensureOwnedDirectory(
      join(projectsRoot, projectDirectoryName(projectId)),
      projectsRoot,
    );
    const assetsRoot = await ensureOwnedDirectory(
      join(projectRoot, PROJECT_ASSETS_REF),
      projectRoot,
    );
    const nodesRoot = await ensureOwnedDirectory(
      join(projectRoot, PROJECT_NODES_REF),
      projectRoot,
    );
    return freezeWorkspace({ projectId, root: projectRoot, assetsRoot, nodesRoot });
  }

  async get(projectId: ProjectId): Promise<ProjectWorkspace | undefined> {
    this.requireProject(projectId);
    const projectsRoot = await this.projectsRoot();
    const candidate = join(projectsRoot, projectDirectoryName(projectId));

    let info;
    try {
      info = await lstat(candidate);
    } catch (error: unknown) {
      if (isCode(error, "ENOENT")) return undefined;
      throw classifyWorkspaceIoError(
        error,
        "Project Workspace could not be inspected.",
      );
    }
    if (info.isSymbolicLink()) {
      throw new WorkspaceError(
        "path-not-allowed",
        "Project Workspace root cannot be a symbolic link.",
      );
    }
    if (!info.isDirectory()) {
      throw new WorkspaceError(
        "not-a-directory",
        "Project Workspace root must be a directory.",
      );
    }

    const projectRoot = await ensureOwnedDirectory(candidate, projectsRoot);
    return freezeWorkspace({
      projectId,
      root: projectRoot,
      assetsRoot: join(projectRoot, PROJECT_ASSETS_REF),
      nodesRoot: join(projectRoot, PROJECT_NODES_REF),
    });
  }

  async resolve(projectId: ProjectId, ref: string): Promise<WorkspaceTarget> {
    const workspace = await this.get(projectId);
    if (workspace === undefined) {
      throw new WorkspaceError(
        "workspace-not-found",
        "Project Workspace has not been created.",
      );
    }
    return resolveWorkspaceTarget(projectId, workspace.root, ref);
  }

  async cleanup(projectId: ProjectId): Promise<boolean> {
    this.requireProject(projectId);
    const projectsRoot = await this.projectsRoot();
    const candidate = join(projectsRoot, projectDirectoryName(projectId));

    let info;
    try {
      info = await lstat(candidate);
    } catch (error: unknown) {
      if (isCode(error, "ENOENT")) return false;
      throw classifyWorkspaceIoError(
        error,
        "Project Workspace could not be inspected before cleanup.",
      );
    }
    if (info.isSymbolicLink()) {
      throw new WorkspaceError(
        "path-not-allowed",
        "Project Workspace cleanup refuses symbolic-link roots.",
      );
    }
    if (!info.isDirectory()) {
      throw new WorkspaceError(
        "not-a-directory",
        "Project Workspace cleanup requires a directory.",
      );
    }

    const canonical = await ensureOwnedDirectory(candidate, projectsRoot);
    assertContained(projectsRoot, canonical);
    try {
      await rm(candidate, { recursive: true, force: false });
    } catch (error: unknown) {
      throw classifyWorkspaceIoError(
        error,
        "Project Workspace cleanup failed.",
      );
    }
    return true;
  }

  private async projectsRoot(): Promise<string> {
    if (this.projectsRootPromise !== undefined) {
      return this.projectsRootPromise;
    }
    const pending = this.prepareProjectsRoot();
    this.projectsRootPromise = pending;
    try {
      return await pending;
    } catch (error: unknown) {
      if (this.projectsRootPromise === pending) {
        this.projectsRootPromise = undefined;
      }
      throw error;
    }
  }

  private async prepareProjectsRoot(): Promise<string> {
    const baseRoot = await canonicalBaseRoot(this.configuredRoot);
    return ensureOwnedDirectory(join(baseRoot, "projects"), baseRoot);
  }

  private requireProject(projectId: ProjectId): void {
    if (this.ctx.projects.get(projectId) === undefined) {
      throw new WorkspaceError(
        "project-not-found",
        "Project Workspace requires an existing Project.",
      );
    }
  }
}

function freezeWorkspace(workspace: ProjectWorkspace): ProjectWorkspace {
  return Object.freeze({ ...workspace });
}

declare module "cordis" {
  interface Context {
    projectWorkspaces: ProjectWorkspaceStore;
  }
}
