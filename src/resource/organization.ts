import { posix } from "node:path";
import type { Context } from "cordis";
import type { ProjectId, ResourceId } from "../brand/ids.js";
import type { StorageTransaction } from "../storage/database.js";
import { ResourceError } from "./errors.js";
import { createResourceEvent } from "./events.js";
import { folderPrefixes, insideFolder, libraryPathKey, normalizeLibraryPath,
  numberedFolderPath, numberedLibraryPath, parentLibraryPath } from "./library.js";
import type { ProjectResource, ResourceMetadataPatch } from "./model.js";
import { activeResources } from "./projector.js";
import type { ResourceStore } from "./store.js";
import { requireActiveResourceProject, requireResourceRevision } from "./validation.js";

export interface LibraryDirectory {
  readonly path: string;
  readonly explicit: boolean;
}

export class ResourceOrganization {
  constructor(private readonly ctx: Context, private readonly store: ResourceStore) {}

  folders(projectId: ProjectId): readonly LibraryDirectory[] {
    const explicit = this.ctx.storage.loadFolders(projectId);
    const resourcePaths = this.resources(projectId).map(resource => libraryPathKey(resource.libraryPath));
    const seen = new Set<string>();
    const paths = new Map<string, LibraryDirectory>();
    for (const folder of explicit) {
      const key = libraryPathKey(folder.path);
      if (folder.projectId !== projectId || folder.path !== normalizeLibraryPath(folder.path)
        || seen.has(key) || resourcePaths.some(path => key === path || key.startsWith(`${path}/`))) {
        throw new ResourceError("invalid-history", "Stored library folder conflicts with a Resource or another folder.");
      }
      seen.add(key);
      for (const parent of folderPrefixes(`${folder.path}/item`)) {
        const parentKey = libraryPathKey(parent);
        if (!paths.has(parentKey)) paths.set(parentKey, { path: parent, explicit: false });
      }
      paths.set(key, { path: folder.path, explicit: true });
    }
    for (const resource of this.resources(projectId)) {
      for (const path of folderPrefixes(resource.libraryPath)) {
        const key = libraryPathKey(path);
        if (!paths.has(key)) paths.set(key, { path, explicit: false });
      }
    }
    return Object.freeze([...paths.values()].sort((a, b) => a.path.localeCompare(b.path)));
  }

  browse(projectId: ProjectId, path: string | null = null) {
    const folder = path === null ? null : this.requireFolder(projectId, path).path;
    const parent = folder === null ? null : libraryPathKey(folder);
    const directories = this.folders(projectId).filter(item => {
      const itemParent = parentLibraryPath(item.path);
      return itemParent === null ? parent === null : libraryPathKey(itemParent) === parent;
    });
    const resources = this.resources(projectId).filter(resource => {
      const itemParent = parentLibraryPath(resource.libraryPath);
      return itemParent === null ? parent === null : libraryPathKey(itemParent) === parent;
    });
    return Object.freeze({ directories: Object.freeze(directories), resources: Object.freeze(resources) });
  }

  createFolder(projectId: ProjectId, path: string): LibraryDirectory {
    requireActiveResourceProject(this.ctx, projectId);
    const normalized = normalizeLibraryPath(path);
    this.requireParent(projectId, normalized);
    const occupied = this.occupied(projectId);
    const candidate = numberedFolderPath(normalized, occupied);
    const now = new Date().toISOString();
    this.ctx.storage.atomic(tx => tx.insertFolder({ projectId, path: candidate, createdAt: now, updatedAt: now }));
    this.ctx.storage.write(() => {}, () => this.ctx.emit("project/changed", projectId));
    return { path: candidate, explicit: true };
  }

  organizeResource(input: { projectId: ProjectId; resourceId: ResourceId; expectedRevision: number;
    name?: string; folder?: string; changes?: ResourceMetadataPatch }): ProjectResource {
    requireActiveResourceProject(this.ctx, input.projectId);
    const current = this.requireResource(input.projectId, input.resourceId);
    requireResourceRevision(current, input.expectedRevision);
    const parent = input.folder === undefined ? parentLibraryPath(current.libraryPath)
      : input.folder === "" ? null : normalizeLibraryPath(input.folder);
    if (parent !== null && !this.hasFolder(input.projectId, parent)) throw new ResourceError("folder-unavailable", "Target folder is unavailable.");
    const name = input.name === undefined ? posix.basename(current.libraryPath) : normalizeLibraryPath(input.name);
    if (name.includes("/")) throw new ResourceError("invalid-resource", "Resource name must be one path segment.");
    const target = parent === null ? name : `${parent}/${name}`;
    const occupied = this.occupied(input.projectId, current.libraryPath);
    const candidate = numberedLibraryPath(target, occupied);
    this.requireFilePath(candidate, occupied);
    if (candidate === current.libraryPath && input.name === undefined && input.changes === undefined) return current;
    const event = createResourceEvent({ projectId: input.projectId, resourceId: current.id,
      sequence: this.store.getEvents(input.projectId).length + 1, baseRevision: current.revision,
      type: "resource-organized", data: { libraryPath: candidate,
        ...(input.name === undefined ? {} : { name: posix.basename(candidate) }) } });
    const events = input.changes === undefined ? [event] : [event, createResourceEvent({
      projectId: input.projectId, resourceId: current.id,
      sequence: event.sequence + 1, baseRevision: event.revision,
      type: "resource-updated", data: { changes: input.changes },
    })];
    return this.store.appendMany(events).at(-1)!.resource;
  }

  organizeFolder(projectId: ProjectId, path: string, targetPath: string): LibraryDirectory {
    requireActiveResourceProject(this.ctx, projectId);
    const source = this.requireFolder(projectId, path);
    const target = normalizeLibraryPath(targetPath);
    if (insideFolder(target, source.path)) throw new ResourceError("folder-conflict", "Cannot move a folder into itself.");
    this.requireParent(projectId, target);
    const resources = this.resources(projectId);
    const explicit = this.ctx.storage.loadFolders(projectId);
    const movedFolders = explicit.filter(folder => insideFolder(folder.path, source.path));
    const movedResources = resources.filter(resource => insideFolder(resource.libraryPath, source.path));
    const change = (value: string) => target + value.slice(source.path.length);
    const occupied = new Set<string>();
    for (const folder of this.folders(projectId)) if (!insideFolder(folder.path, source.path)) occupied.add(libraryPathKey(folder.path));
    for (const resource of resources) if (!insideFolder(resource.libraryPath, source.path)) occupied.add(libraryPathKey(resource.libraryPath));
    for (const folder of [source, ...movedFolders]) {
      const destination = change(folder.path);
      if (occupied.has(libraryPathKey(destination))) throw new ResourceError("folder-conflict", "Target folder conflicts with an existing path.");
    }
    for (const resource of movedResources) this.requireFilePath(change(resource.libraryPath), occupied);
    const now = new Date().toISOString();
    const events = movedResources.map((resource, index) => createResourceEvent({ projectId, resourceId: resource.id,
      sequence: this.store.getEvents(projectId).length + index + 1, baseRevision: resource.revision,
      type: "resource-organized", data: { libraryPath: change(resource.libraryPath) } }));
    const persist = (tx: StorageTransaction) => {
      for (const folder of movedFolders) tx.deleteFolder(projectId, folder.path);
      for (const folder of movedFolders) tx.insertFolder({ ...folder, path: change(folder.path), updatedAt: now });
    };
    if (events.length) this.store.appendMany(events, persist);
    else this.ctx.storage.atomic(persist);
    if (events.length === 0) this.ctx.storage.write(() => {}, () => this.ctx.emit("project/changed", projectId));
    return { path: target, explicit: movedFolders.some(folder => libraryPathKey(folder.path) === libraryPathKey(source.path)) };
  }

  async deleteFolder(input: { projectId: ProjectId; path: string; recursive: boolean; operationId: string;
    signal?: AbortSignal;
    deleteResource: (resource: ProjectResource, operationId: string) => Promise<void> }): Promise<{
      status: "confirmation-required" | "deleted" | "partial" | "cancelled";
      deleted: readonly ResourceId[];
      failed: readonly { resourceId: ResourceId; code: string }[];
    }> {
    requireActiveResourceProject(this.ctx, input.projectId);
    const source = this.requireFolder(input.projectId, input.path);
    const resources = this.resources(input.projectId).filter(resource => insideFolder(resource.libraryPath, source.path));
    const descendants = this.folders(input.projectId).filter(folder => folder.path !== source.path && insideFolder(folder.path, source.path));
    if ((resources.length || descendants.length) && !input.recursive) return { status: "confirmation-required", deleted: [], failed: [] };
    const deleted: ResourceId[] = [];
    const failed: { resourceId: ResourceId; code: string }[] = [];
    if (input.signal?.aborted) return { status: "cancelled", deleted, failed };
    for (const resource of resources) {
      if (input.signal?.aborted) return { status: "cancelled", deleted, failed };
      try {
        await input.deleteResource(resource, `${input.operationId}_${resource.id}`);
        deleted.push(resource.id);
      } catch (error) {
        failed.push({ resourceId: resource.id, code: error instanceof ResourceError ? error.code : "delete-failed" });
      }
    }
    if (failed.length) return { status: "partial", deleted, failed };
    const folders = this.ctx.storage.loadFolders(input.projectId).filter(folder => insideFolder(folder.path, source.path));
    this.ctx.storage.atomic(tx => { for (const folder of folders) tx.deleteFolder(input.projectId, folder.path); });
    this.ctx.storage.write(() => {}, () => this.ctx.emit("project/changed", input.projectId));
    return { status: "deleted", deleted, failed };
  }

  occupied(projectId: ProjectId, except?: string): Set<string> {
    const excluded = except === undefined ? null : libraryPathKey(except);
    return new Set([...this.folders(projectId).map(folder => folder.path),
      ...this.resources(projectId).map(resource => resource.libraryPath)]
      .map(libraryPathKey).filter(key => key !== excluded));
  }

  private resources(projectId: ProjectId): readonly ProjectResource[] {
    return activeResources(this.store.listStates(projectId));
  }

  private requireResource(projectId: ProjectId, resourceId: ResourceId): ProjectResource {
    const state = this.store.getState(resourceId);
    if (state?.status !== "active" || state.resource.projectId !== projectId) throw new ResourceError("resource-unavailable", "Resource is unavailable.");
    return state.resource;
  }

  private hasFolder(projectId: ProjectId, path: string): boolean {
    return this.folders(projectId).some(folder => libraryPathKey(folder.path) === libraryPathKey(path));
  }

  private requireFolder(projectId: ProjectId, path: string): LibraryDirectory {
    const key = libraryPathKey(normalizeLibraryPath(path));
    const folder = this.folders(projectId).find(item => libraryPathKey(item.path) === key);
    if (folder === undefined) throw new ResourceError("folder-unavailable", "Folder is unavailable.");
    return folder;
  }

  private requireParent(projectId: ProjectId, path: string): void {
    const parent = parentLibraryPath(path);
    if (parent !== null && !this.hasFolder(projectId, parent)) throw new ResourceError("folder-unavailable", "Parent folder is unavailable.");
  }

  private requireFilePath(path: string, occupied: ReadonlySet<string>): void {
    const key = libraryPathKey(path);
    if (occupied.has(key) || [...occupied].some(item => item.startsWith(`${key}/`))) {
      throw new ResourceError("folder-conflict", "Target file path conflicts with an existing directory.");
    }
  }
}
