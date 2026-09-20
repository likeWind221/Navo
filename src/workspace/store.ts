import { lstat, rm } from "node:fs/promises";
import { join } from "node:path";

import { Service } from "cordis";
import type { Context } from "cordis";

import type { ProjectId } from "../brand/ids.js";
import { WorkspaceError } from "./errors.js";
import {
  NAVO_INTERNAL_REF,
  PROJECT_ASSETS_REF,
  PROJECT_NODES_REF,
  PROJECT_SKILLS_REF,
} from "./model.js";
import type {
  ProjectWorkspace,
  WorkspaceTarget,
} from "./model.js";
import {
  assertContained,
  canonicalWorkspaceRoot,
  classifyWorkspaceIoError,
  ensureOwnedDirectory,
  isCode,
  resolveWorkspaceTarget,
  validateWorkspaceRoot,
} from "./path.js";

export class ProjectWorkspaceStore extends Service {
  static inject = ["projects"];

  private readonly byProject = new Map<ProjectId, ProjectWorkspace>();
  private readonly byRoot = new Map<string, ProjectId>();

  constructor(ctx: Context) {
    super(ctx, "projectWorkspaces");
  }

  async create(projectId: ProjectId, root: string): Promise<ProjectWorkspace> {
    this.requireProject(projectId);
    const canonicalRoot = await canonicalWorkspaceRoot(validateWorkspaceRoot(root));

    const existing = this.byProject.get(projectId);
    if (existing !== undefined) {
      if (existing.root === canonicalRoot) return existing;
      throw new WorkspaceError(
        "workspace-conflict",
        "Project is already bound to a different Workspace root.",
      );
    }

    const owner = this.byRoot.get(canonicalRoot);
    if (owner !== undefined && owner !== projectId) {
      throw new WorkspaceError(
        "workspace-conflict",
        "Workspace root is already bound to another Project.",
      );
    }

    const navoRoot = await ensureOwnedDirectory(
      join(canonicalRoot, NAVO_INTERNAL_REF),
      canonicalRoot,
    );
    const assetsRoot = await ensureOwnedDirectory(
      join(navoRoot, PROJECT_ASSETS_REF),
      navoRoot,
    );
    const nodesRoot = await ensureOwnedDirectory(
      join(navoRoot, PROJECT_NODES_REF),
      navoRoot,
    );
    const skillsRoot = await ensureOwnedDirectory(
      join(navoRoot, PROJECT_SKILLS_REF),
      navoRoot,
    );

    const workspace = freezeWorkspace({
      projectId,
      root: canonicalRoot,
      navoRoot,
      assetsRoot,
      nodesRoot,
      skillsRoot,
    });
    this.byProject.set(projectId, workspace);
    this.byRoot.set(canonicalRoot, projectId);
    return workspace;
  }

  async get(projectId: ProjectId): Promise<ProjectWorkspace | undefined> {
    this.requireProject(projectId);
    return this.byProject.get(projectId);
  }

  async resolve(projectId: ProjectId, ref: string): Promise<WorkspaceTarget> {
    const workspace = await this.get(projectId);
    if (workspace === undefined) {
      throw new WorkspaceError(
        "workspace-not-found",
        "Project Workspace has not been bound.",
      );
    }
    return resolveWorkspaceTarget(projectId, workspace.navoRoot, ref);
  }

  async cleanup(projectId: ProjectId): Promise<boolean> {
    this.requireProject(projectId);
    const workspace = this.byProject.get(projectId);
    if (workspace === undefined) return false;

    let info;
    try {
      info = await lstat(workspace.navoRoot);
    } catch (error: unknown) {
      if (isCode(error, "ENOENT")) {
        this.unbind(workspace);
        return false;
      }
      throw classifyWorkspaceIoError(
        error,
        "Navo Workspace directory could not be inspected before cleanup.",
      );
    }
    if (info.isSymbolicLink()) {
      throw new WorkspaceError(
        "path-not-allowed",
        "Navo Workspace cleanup refuses symbolic-link roots.",
      );
    }
    if (!info.isDirectory()) {
      throw new WorkspaceError(
        "not-a-directory",
        "Navo Workspace root must be a directory.",
      );
    }

    const canonical = await canonicalWorkspaceRoot(workspace.navoRoot);
    assertContained(workspace.root, canonical);
    try {
      await rm(workspace.navoRoot, { recursive: true, force: false });
    } catch (error: unknown) {
      throw classifyWorkspaceIoError(
        error,
        "Navo Workspace cleanup failed.",
      );
    }
    this.unbind(workspace);
    return true;
  }

  private unbind(workspace: ProjectWorkspace): void {
    this.byProject.delete(workspace.projectId);
    if (this.byRoot.get(workspace.root) === workspace.projectId) {
      this.byRoot.delete(workspace.root);
    }
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
