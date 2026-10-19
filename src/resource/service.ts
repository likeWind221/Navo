import { Service } from "cordis";
import type { Context } from "cordis";

import { createProjectId } from "../brand/ids.js";
import type {
  ProjectId,
  ResourceId,
} from "../brand/ids.js";
import {
  canReadResource,
  normalizeResourceAccess,
  normalizeResourcePrincipal,
  requireResourceAccessManager,
  requireResourceOwner,
  sameResourceAccess,
} from "./access.js";
import { StorageError } from "../storage/errors.js";
import { ResourceError } from "./errors.js";
import type { ResourceEvent } from "./events.js";
import { createResourceEvent } from "./events.js";
import { parseResourceHistory } from "./history.js";
import type {
  DeleteResourceInput,
  ProjectResource,
  PublishResourceInput,
  ReplaceResourceInput,
  ResourceEntryTarget,
  ResourcePrincipal,
  SetResourceAccessInput,
  UpdateResourceInput,
} from "./model.js";
import {
  resolveResourceEntry,
} from "./path.js";
import { ResourceLifecycle } from "./lifecycle.js";
import { ASSET_LIMITS } from "./assets.js";
import { publishResource, replaceResource } from "./publication.js";
import { activeResources } from "./projector.js";
import { ResourceStore } from "./store.js";
import {
  effectiveResourceChanges,
  requireActiveResourceProject,
  requireResourceAccessNodes,
  requireResourcePrincipal,
  requireResourceProject,
  requireResourceRevision,
  requireResourceWorkspace,
  validateResourcePatch,
} from "./validation.js";

const emptyResources: readonly ProjectResource[] = Object.freeze([]);

export interface ResourceConfig {
  readonly maxFileBytes?: number;
}

export class ResourceService extends Service {
  static inject = ["storage", "projects", "nodes", "projectWorkspaces"];
  private readonly store = new ResourceStore(this.ctx.storage, projectId => this.ctx.emit("project/changed", projectId));

  private readonly lifecycle: ResourceLifecycle;

  constructor(ctx: Context, config: ResourceConfig = {}) {
    super(ctx, "resources");
    const maxFileBytes = config.maxFileBytes ?? ASSET_LIMITS.maxFileBytes;
    if (!Number.isSafeInteger(maxFileBytes) || maxFileBytes < 1 || maxFileBytes > ASSET_LIMITS.maxFileBytes) {
      throw new ResourceError("invalid-resource", "Resource maxFileBytes must be between 1 byte and 100 MiB.");
    }
    this.lifecycle = new ResourceLifecycle(this.ctx, this.store, maxFileBytes);
    for (const [ownerId, stored] of ctx.storage.recovery.events.get("resource")!) {
      try {
        if (stored.projectId !== ownerId) throw new ResourceError("invalid-history", "Resource Project does not match its storage owner.");
        const projectId = createProjectId(ownerId);
        requireResourceProject(ctx, projectId);
        this.store.restore(projectId, parseResourceHistory(ctx, projectId, stored.events));
      } catch (error: unknown) {
        throw new StorageError("invalid-record", `Stored resource history ${ownerId} is invalid.`, { cause: error });
      }
    }
  }

  publish(input: PublishResourceInput, signal?: AbortSignal): Promise<ProjectResource> {
    return publishResource(this.lifecycle, input, signal);
  }

  replace(input: ReplaceResourceInput, signal?: AbortSignal): Promise<ProjectResource> {
    return replaceResource(this.lifecycle, input, signal);
  }

  recover(): Promise<void> {
    return this.lifecycle.recovery.recover();
  }

  withEntry<T>(projectId: ProjectId, resourceId: ResourceId, viewer: ResourcePrincipal,
    work: (resource: ProjectResource, target: ResourceEntryTarget) => Promise<T>): Promise<T> {
    requireResourceProject(this.ctx, projectId);
    return this.lifecycle.read(projectId, resourceId, viewer, work);
  }

  update(input: UpdateResourceInput): ProjectResource {
    requireActiveResourceProject(this.ctx, input.projectId);
    const actor = normalizeResourcePrincipal(input.actor);
    requireResourcePrincipal(this.ctx, input.projectId, actor);
    const current = this.requireCurrent(input.projectId, input.resourceId);
    requireResourceOwner(current, actor);
    requireResourceRevision(current, input.expectedRevision);
    const changes = validateResourcePatch(input.changes);
    const effective = effectiveResourceChanges(current, changes);
    if (Object.keys(effective).length === 0) return current;

    return this.store.append(this.event(
      input.projectId,
      input.resourceId,
      current.revision,
      "resource-updated",
      { changes: effective },
    )).resource;
  }

  setAccess(input: SetResourceAccessInput): ProjectResource {
    requireActiveResourceProject(this.ctx, input.projectId);
    const actor = normalizeResourcePrincipal(input.actor);
    requireResourcePrincipal(this.ctx, input.projectId, actor);
    requireResourceAccessManager(actor);
    const current = this.requireCurrent(input.projectId, input.resourceId);
    requireResourceRevision(current, input.expectedRevision);
    const access = normalizeResourceAccess(input.access, current.owner);
    requireResourceAccessNodes(this.ctx, input.projectId, access);
    if (sameResourceAccess(current.access, access)) return current;

    return this.store.append(this.event(
      input.projectId,
      input.resourceId,
      current.revision,
      "resource-access-changed",
      { access },
    )).resource;
  }

  delete(input: DeleteResourceInput): Promise<void> {
    return this.lifecycle.delete(input);
  }

  get(
    projectId: ProjectId,
    resourceId: ResourceId,
  ): ProjectResource | undefined {
    requireResourceProject(this.ctx, projectId);
    const state = this.store.getState(resourceId);
    if (state === undefined) return undefined;
    if (state.resource.projectId !== projectId) {
      throw new ResourceError(
        "resource-unavailable",
        "Resource does not belong to the requested Project.",
      );
    }
    return state.status === "active" ? state.resource : undefined;
  }

  listByProject(projectId: ProjectId): readonly ProjectResource[] {
    requireResourceProject(this.ctx, projectId);
    return activeResources(this.store.listStates(projectId));
  }

  getVisible(
    projectId: ProjectId,
    resourceId: ResourceId,
    viewer: ResourcePrincipal,
  ): ProjectResource | undefined {
    const principal = normalizeResourcePrincipal(viewer);
    requireResourceProject(this.ctx, projectId);
    requireResourcePrincipal(this.ctx, projectId, principal);
    const resource = this.get(projectId, resourceId);
    if (resource === undefined) return undefined;
    return canReadResource(resource, principal) ? resource : undefined;
  }

  listVisible(
    projectId: ProjectId,
    viewer: ResourcePrincipal,
  ): readonly ProjectResource[] {
    const principal = normalizeResourcePrincipal(viewer);
    requireResourceProject(this.ctx, projectId);
    requireResourcePrincipal(this.ctx, projectId, principal);
    const resources = this.listByProject(projectId)
      .filter(resource => canReadResource(resource, principal));
    return resources.length === 0 ? emptyResources : Object.freeze(resources);
  }

  async resolveEntry(
    projectId: ProjectId,
    resourceId: ResourceId,
    viewer?: ResourcePrincipal,
  ): Promise<ResourceEntryTarget & { release(): void }> {
    requireResourceProject(this.ctx, projectId);
    const lease = this.lifecycle.lease(projectId, resourceId, viewer);
    try {
      const target = await resolveResourceEntry(await requireResourceWorkspace(this.ctx, projectId), lease.resource);
      return Object.freeze({ ...target, release: lease.release });
    } catch (error) {
      lease.release();
      throw error;
    }
  }

  getEvents(projectId: ProjectId): readonly ResourceEvent[] {
    requireResourceProject(this.ctx, projectId);
    return this.store.getEvents(projectId);
  }

  async restore(
    projectId: ProjectId,
    history: readonly unknown[],
  ): Promise<readonly ProjectResource[]> {
    requireResourceProject(this.ctx, projectId);
    await requireResourceWorkspace(this.ctx, projectId);
    if (this.store.hasHistory(projectId)) {
      throw new ResourceError(
        "registry-already-restored",
        "Cannot overwrite an existing Project Resource history.",
      );
    }
    const events = parseResourceHistory(this.ctx, projectId, history);
    return activeResources(this.store.restore(projectId, events));
  }

  private event<TType extends ResourceEvent["type"]>(
    projectId: ProjectId,
    resourceId: ResourceId,
    baseRevision: number,
    type: TType,
    data: Extract<ResourceEvent, { type: TType }>["data"],
  ): Extract<ResourceEvent, { type: TType }> {
    return createResourceEvent({
      projectId,
      resourceId,
      sequence: this.store.getEvents(projectId).length + 1,
      baseRevision,
      type,
      data,
    }) as Extract<ResourceEvent, { type: TType }>;
  }

  private requireCurrent(
    projectId: ProjectId,
    resourceId: ResourceId,
  ): ProjectResource {
    const resource = this.get(projectId, resourceId);
    if (resource !== undefined) return resource;
    throw new ResourceError("resource-unavailable", "Resource is unavailable.");
  }

}

declare module "cordis" {
  interface Context {
    resources: ResourceService;
  }
}

export const ResourceRecovery = Object.assign(async (ctx: Context): Promise<void> => {
  await ctx.resources.recover();
}, { inject: ["resources"] });
