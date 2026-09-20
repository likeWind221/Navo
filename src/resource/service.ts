import { randomUUID } from "node:crypto";

import { Service } from "cordis";
import type { Context } from "cordis";

import { createResourceId } from "../brand/ids.js";
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
import { ResourceError } from "./errors.js";
import type { ResourceEvent } from "./events.js";
import { createResourceEvent } from "./events.js";
import { parseResourceHistory } from "./history.js";
import type {
  DeleteResourceInput,
  ProjectResource,
  PublishResourceInput,
  ResourceEntryTarget,
  ResourcePrincipal,
  SetResourceAccessInput,
  UpdateResourceInput,
} from "./model.js";
import {
  resourceEntryRefFromSource,
  resolveResourceEntry,
} from "./path.js";
import {
  discardPublishedResourceContent,
  publishResourceContent,
} from "./publication.js";
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
  validateResourceMetadata,
  validateResourcePatch,
} from "./validation.js";

const emptyResources: readonly ProjectResource[] = Object.freeze([]);

export class ResourceService extends Service {
  static inject = ["projects", "nodes", "projectWorkspaces"];
  private readonly store = new ResourceStore();

  constructor(ctx: Context) {
    super(ctx, "resources");
  }

  async publish(
    input: PublishResourceInput,
    signal?: AbortSignal,
  ): Promise<ProjectResource> {
    requireActiveResourceProject(this.ctx, input.projectId);
    const owner = normalizeResourcePrincipal(input.owner);
    requireResourcePrincipal(this.ctx, input.projectId, owner);
    const entryRef = resourceEntryRefFromSource(input.sourceRef);
    const metadata = validateResourceMetadata({ ...input, entryRef });
    const workspace = await requireResourceWorkspace(this.ctx, input.projectId);
    const resourceId = this.nextId();

    const published = await publishResourceContent(
      workspace,
      resourceId,
      input.sourceRef,
      signal,
    );
    try {
      signal?.throwIfAborted();
      requireActiveResourceProject(this.ctx, input.projectId);
      requireResourcePrincipal(this.ctx, input.projectId, owner);
      return this.store.append(this.event(
        input.projectId,
        resourceId,
        0,
        "resource-created",
        {
          owner,
          name: metadata.name,
          description: metadata.description,
          resourceType: metadata.type,
          entryRef: published.entryRef,
        },
      )).resource;
    } catch (error: unknown) {
      await discardPublishedResourceContent(published.root);
      throw error;
    }
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

  delete(input: DeleteResourceInput): void {
    requireActiveResourceProject(this.ctx, input.projectId);
    const actor = normalizeResourcePrincipal(input.actor);
    requireResourcePrincipal(this.ctx, input.projectId, actor);
    const current = this.requireCurrent(input.projectId, input.resourceId);
    requireResourceOwner(current, actor);
    requireResourceRevision(current, input.expectedRevision);
    this.store.append(this.event(
      input.projectId,
      input.resourceId,
      current.revision,
      "resource-deleted",
      {},
    ));
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
  ): Promise<ResourceEntryTarget> {
    const resource = viewer === undefined
      ? this.get(projectId, resourceId)
      : this.getVisible(projectId, resourceId, viewer);
    if (resource === undefined) {
      throw new ResourceError(
        "resource-unavailable",
        "Resource is unavailable to the requested Project or viewer.",
      );
    }
    return resolveResourceEntry(
      await requireResourceWorkspace(this.ctx, projectId),
      resource,
    );
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

  private nextId(): ResourceId {
    let resourceId: ResourceId;
    do resourceId = createResourceId(randomUUID());
    while (this.store.has(resourceId));
    return resourceId;
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
