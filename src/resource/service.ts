import { randomUUID } from "node:crypto";

import { Service } from "cordis";
import type { Context } from "cordis";

import {
  createEventId,
  createResourceId,
} from "../brand/ids.js";
import type {
  ProjectId,
  ResourceId,
} from "../brand/ids.js";
import {
  canReadResource,
  normalizeResourceAccess,
  sameResourceAccess,
} from "./access.js";
import { ResourceError } from "./errors.js";
import type { ResourceEvent } from "./events.js";
import { freezeResourceEvent } from "./events.js";
import { parseResourceHistory } from "./history.js";
import type {
  CreateResourceInput,
  DeleteResourceInput,
  ProjectResource,
  ResourceEntryTarget,
  ResourceViewer,
  SetResourceAccessInput,
  UpdateResourceInput,
} from "./model.js";
import {
  ensureResourceRoot,
  resolveResourceEntry,
} from "./path.js";
import { activeResources } from "./projector.js";
import {
  effectiveResourceChanges,
  requireResourceAccessNodes,
  requireResourceWorkNode,
  validateResourceMetadata,
  validateResourcePatch,
} from "./validation.js";

const emptyResources: readonly ProjectResource[] = Object.freeze([]);

export class ResourceService extends Service {
  static inject = ["projects", "nodes", "projectWorkspaces", "resourceStore"];

  constructor(ctx: Context) {
    super(ctx, "resources");
  }

  async create(input: CreateResourceInput): Promise<ProjectResource> {
    this.requireActiveProject(input.projectId);
    requireResourceWorkNode(this.ctx, input.projectId, input.sourceNodeId);
    const metadata = validateResourceMetadata(input);
    const workspace = await this.requireWorkspace(input.projectId);

    let resourceId: ResourceId;
    do resourceId = createResourceId(randomUUID());
    while (this.ctx.resourceStore.has(resourceId));

    await ensureResourceRoot(workspace, resourceId);
    this.requireActiveProject(input.projectId);
    requireResourceWorkNode(this.ctx, input.projectId, input.sourceNodeId);

    const event = this.eventHeader(
      input.projectId,
      resourceId,
      0,
      "resource-created",
      {
        sourceNodeId: input.sourceNodeId,
        name: metadata.name,
        description: metadata.description,
        resourceType: metadata.type,
        entryRef: metadata.entryRef,
      },
    );
    return this.ctx.resourceStore.append(event).resource;
  }

  update(input: UpdateResourceInput): ProjectResource {
    this.requireActiveProject(input.projectId);
    const current = this.requireCurrent(input.projectId, input.resourceId);
    this.requireRevision(current, input.expectedRevision);
    const changes = validateResourcePatch(input.changes);
    const effective = effectiveResourceChanges(current, changes);
    if (Object.keys(effective).length === 0) return current;

    return this.ctx.resourceStore.append(this.eventHeader(
      input.projectId,
      input.resourceId,
      current.revision,
      "resource-updated",
      { changes: effective },
    )).resource;
  }

  setAccess(input: SetResourceAccessInput): ProjectResource {
    this.requireActiveProject(input.projectId);
    const current = this.requireCurrent(input.projectId, input.resourceId);
    this.requireRevision(current, input.expectedRevision);
    const access = normalizeResourceAccess(input.access, current.sourceNodeId);
    requireResourceAccessNodes(this.ctx, input.projectId, access);
    if (sameResourceAccess(current.access, access)) return current;

    return this.ctx.resourceStore.append(this.eventHeader(
      input.projectId,
      input.resourceId,
      current.revision,
      "resource-access-changed",
      { access },
    )).resource;
  }

  delete(input: DeleteResourceInput): void {
    this.requireActiveProject(input.projectId);
    const current = this.requireCurrent(input.projectId, input.resourceId);
    this.requireRevision(current, input.expectedRevision);
    this.ctx.resourceStore.append(this.eventHeader(
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
    this.requireProject(projectId);
    const state = this.ctx.resourceStore.getState(resourceId);
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
    this.requireProject(projectId);
    return activeResources(this.ctx.resourceStore.listStates(projectId));
  }

  getVisible(
    projectId: ProjectId,
    resourceId: ResourceId,
    viewer: ResourceViewer,
  ): ProjectResource | undefined {
    this.requireViewer(projectId, viewer);
    const resource = this.get(projectId, resourceId);
    if (resource === undefined) return undefined;
    return canReadResource(resource, viewer) ? resource : undefined;
  }

  listVisible(
    projectId: ProjectId,
    viewer: ResourceViewer,
  ): readonly ProjectResource[] {
    this.requireViewer(projectId, viewer);
    const resources = this.listByProject(projectId)
      .filter(resource => canReadResource(resource, viewer));
    return resources.length === 0 ? emptyResources : Object.freeze(resources);
  }

  async resolveEntry(
    projectId: ProjectId,
    resourceId: ResourceId,
    viewer?: ResourceViewer,
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
      await this.requireWorkspace(projectId),
      resource,
    );
  }

  getEvents(projectId: ProjectId): readonly ResourceEvent[] {
    this.requireProject(projectId);
    return this.ctx.resourceStore.getEvents(projectId);
  }

  async restore(
    projectId: ProjectId,
    history: readonly unknown[],
  ): Promise<readonly ProjectResource[]> {
    this.requireProject(projectId);
    await this.requireWorkspace(projectId);
    if (this.ctx.resourceStore.hasHistory(projectId)) {
      throw new ResourceError(
        "registry-already-restored",
        "Cannot overwrite an existing Project Resource history.",
      );
    }
    const events = parseResourceHistory(this.ctx, projectId, history);
    return activeResources(this.ctx.resourceStore.restore(projectId, events));
  }

  private eventHeader<TType extends ResourceEvent["type"]>(
    projectId: ProjectId,
    resourceId: ResourceId,
    baseRevision: number,
    type: TType,
    data: Extract<ResourceEvent, { type: TType }>["data"],
  ): Extract<ResourceEvent, { type: TType }> {
    return freezeResourceEvent({
      version: 2,
      id: createEventId(randomUUID()),
      projectId,
      resourceId,
      sequence: this.ctx.resourceStore.getEvents(projectId).length + 1,
      revision: baseRevision + 1,
      baseRevision,
      timestamp: new Date().toISOString(),
      type,
      data,
    } as Extract<ResourceEvent, { type: TType }>) as Extract<ResourceEvent, { type: TType }>;
  }

  private requireRevision(
    resource: ProjectResource,
    expectedRevision: number,
  ): void {
    if (
      !Number.isSafeInteger(expectedRevision)
      || expectedRevision < 1
      || resource.revision !== expectedRevision
    ) {
      throw new ResourceError(
        "stale-revision",
        "Read the current Resource before modifying it.",
      );
    }
  }

  private requireCurrent(
    projectId: ProjectId,
    resourceId: ResourceId,
  ): ProjectResource {
    const resource = this.get(projectId, resourceId);
    if (resource !== undefined) return resource;
    throw new ResourceError("resource-unavailable", "Resource is unavailable.");
  }

  private requireProject(projectId: ProjectId): void {
    if (this.ctx.projects.get(projectId) === undefined) {
      throw new ResourceError(
        "project-unavailable",
        "Resource Service requires an existing Project.",
      );
    }
  }

  private requireActiveProject(projectId: ProjectId): void {
    if (this.ctx.projects.get(projectId)?.status !== "active") {
      throw new ResourceError(
        "project-unavailable",
        "Resource mutation requires an active Project.",
      );
    }
  }

  private requireViewer(projectId: ProjectId, viewer: ResourceViewer): void {
    this.requireProject(projectId);
    if (viewer.kind === "node") {
      requireResourceWorkNode(this.ctx, projectId, viewer.nodeId);
    }
  }

  private async requireWorkspace(projectId: ProjectId) {
    const workspace = await this.ctx.projectWorkspaces.get(projectId);
    if (workspace !== undefined) return workspace;
    throw new ResourceError(
      "workspace-unavailable",
      "Resource Service requires a bound Project Workspace.",
    );
  }
}


declare module "cordis" {
  interface Context {
    resources: ResourceService;
  }
}
