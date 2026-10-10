import { lstat, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { Service } from "cordis";
import type { Context } from "cordis";

import { createProjectId } from "../brand/ids.js";
import type { ProjectId } from "../brand/ids.js";
import { StorageError } from "../storage/errors.js";
import { WorkspaceError } from "./errors.js";
import {
  NAVO_INTERNAL_REF,
  PROJECT_ASSETS_REF,
  PROJECT_NODES_REF,
  PROJECT_SKILLS_REF,
} from "./model.js";
import type {
  PreparedWorkspace,
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
  static inject = ["projects", "storage"];

  private readonly byProject = new Map<ProjectId, ProjectWorkspace>();
  private readonly byRoot = new Map<string, ProjectId>();

  constructor(ctx: Context) {
    super(ctx, "projectWorkspaces");
    for (const binding of ctx.storage.loadWorkspaceBindings()) {
      const projectId = createProjectId(binding.projectId);
      if (ctx.projects.get(projectId) === undefined) {
        throw new StorageError("invalid-record", `Stored Workspace binding references missing Project ${projectId}.`);
      }
      this.remember(freezeWorkspace({ projectId, ...workspacePaths(binding.root) }));
    }
  }

  async create(projectId: ProjectId, root: string): Promise<ProjectWorkspace> {
    this.requireProject(projectId);
    const existing = this.byProject.get(projectId);
    if (existing === undefined) return this.bind(projectId, await this.prepare(root));
    if (existing.root === await canonicalWorkspaceRoot(validateWorkspaceRoot(root))) return existing;
    throw new WorkspaceError(
      "workspace-conflict",
      "Project is already bound to a different Workspace root.",
    );
  }

  async prepare(root: string): Promise<PreparedWorkspace> {
    const canonicalRoot = await canonicalWorkspaceRoot(validateWorkspaceRoot(root));
    if (this.byRoot.has(canonicalRoot)) {
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
    return Object.freeze({ root: canonicalRoot, navoRoot, assetsRoot, nodesRoot, skillsRoot });
  }

  bind(projectId: ProjectId, prepared: PreparedWorkspace): ProjectWorkspace {
    const existing = this.byProject.get(projectId);
    if (existing !== undefined) {
      if (existing.root === prepared.root) return existing;
      throw new WorkspaceError(
        "workspace-conflict",
        "Project is already bound to a different Workspace root.",
      );
    }
    if (this.byRoot.has(prepared.root)) {
      throw new WorkspaceError(
        "workspace-conflict",
        "Workspace root is already bound to another Project.",
      );
    }
    const workspace = freezeWorkspace({ projectId, ...prepared });
    this.ctx.storage.write(tx => {
      if (this.ctx.projects.get(projectId) === undefined && !tx.hasEvents("project", projectId)) {
        throw new WorkspaceError(
          "project-not-found",
          "Project Workspace requires an existing Project.",
        );
      }
      tx.bindWorkspace({ projectId, root: workspace.root });
    }, () => this.remember(workspace));
    return workspace;
  }

  async require(projectId: ProjectId): Promise<ProjectWorkspace> {
    const workspace = await this.get(projectId);
    if (workspace === undefined) {
      throw new WorkspaceError(
        "workspace-not-found",
        "Project Workspace has not been bound.",
      );
    }
    for (const path of [workspace.root, workspace.navoRoot]) {
      let info;
      try {
        info = await stat(path);
      } catch (error: unknown) {
        if (isCode(error, "ENOENT") || isCode(error, "ENOTDIR")) throw unavailable();
        throw classifyWorkspaceIoError(error, "Project Workspace could not be inspected.");
      }
      if (!info.isDirectory()) throw unavailable();
    }
    return workspace;
  }

  async get(projectId: ProjectId): Promise<ProjectWorkspace | undefined> {
    this.requireProject(projectId);
    return this.byProject.get(projectId);
  }

  async resolve(projectId: ProjectId, ref: string): Promise<WorkspaceTarget> {
    const workspace = await this.require(projectId);
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

  private remember(workspace: ProjectWorkspace): void {
    this.byProject.set(workspace.projectId, workspace);
    this.byRoot.set(workspace.root, workspace.projectId);
  }

  private unbind(workspace: ProjectWorkspace): void {
    this.ctx.storage.write(tx => tx.unbindWorkspace(workspace.projectId), () => {
      this.byProject.delete(workspace.projectId);
      if (this.byRoot.get(workspace.root) === workspace.projectId) {
        this.byRoot.delete(workspace.root);
      }
    });
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

function workspacePaths(root: string): PreparedWorkspace {
  const navoRoot = join(root, NAVO_INTERNAL_REF);
  return {
    root,
    navoRoot,
    assetsRoot: join(navoRoot, PROJECT_ASSETS_REF),
    nodesRoot: join(navoRoot, PROJECT_NODES_REF),
    skillsRoot: join(navoRoot, PROJECT_SKILLS_REF),
  };
}

function unavailable(): WorkspaceError {
  return new WorkspaceError(
    "workspace-unavailable",
    "Project Workspace directory is missing; restore it or bind the Project again.",
  );
}

declare module "cordis" {
  interface Context {
    projectWorkspaces: ProjectWorkspaceStore;
  }
}
