import { randomUUID } from "node:crypto";

import { Service } from "cordis";
import type { Context } from "cordis";

import {
  createEventId,
  createNodeId,
  createResourceId,
} from "../brand/ids.js";
import type {
  NodeId,
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
import type {
  CreateResourceInput,
  DeleteResourceInput,
  ProjectResource,
  ResourceAccess,
  ResourceEntryTarget,
  ResourceMetadataPatch,
  ResourceViewer,
  SetResourceAccessInput,
  UpdateResourceInput,
} from "./model.js";
import {
  ensureResourceRoot,
  resolveResourceEntry,
  validateResourceEntryRef,
} from "./path.js";
import {
  projectResourceEvent,
  type ResourceState,
} from "./projector.js";

const emptyResources: readonly ProjectResource[] = Object.freeze([]);

export class ResourceService extends Service {
  static inject = ["projects", "nodes", "projectWorkspaces", "resourceStore"];

  constructor(ctx: Context) {
    super(ctx, "resources");
  }

  async create(input: CreateResourceInput): Promise<ProjectResource> {
    this.requireActiveProject(input.projectId);
    this.requireWorkNode(input.projectId, input.sourceNodeId);
    const metadata = this.validateMetadata(input);
    const workspace = await this.requireWorkspace(input.projectId);

    let resourceId: ResourceId;
    do resourceId = createResourceId(randomUUID());
    while (this.ctx.resourceStore.has(resourceId));

    await ensureResourceRoot(workspace, resourceId);
    this.requireActiveProject(input.projectId);
    this.requireWorkNode(input.projectId, input.sourceNodeId);

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
    const changes = this.validatePatch(input.changes);
    const effective = this.effectiveChanges(current, changes);
    if (Object.keys(effective).length === 0) return current;

    const event = this.eventHeader(
      input.projectId,
      input.resourceId,
      current.revision,
      "resource-updated",
      { changes: effective },
    );
    return this.ctx.resourceStore.append(event).resource;
  }

  setAccess(input: SetResourceAccessInput): ProjectResource {
    this.requireActiveProject(input.projectId);
    const current = this.requireCurrent(input.projectId, input.resourceId);
    this.requireRevision(current, input.expectedRevision);
    const access = normalizeResourceAccess(input.access, current.sourceNodeId);
    this.requireAccessNodes(input.projectId, access);
    if (sameResourceAccess(current.access, access)) return current;

    const event = this.eventHeader(
      input.projectId,
      input.resourceId,
      current.revision,
      "resource-access-changed",
      { access },
    );
    return this.ctx.resourceStore.append(event).resource;
  }

  delete(input: DeleteResourceInput): void {
    this.requireActiveProject(input.projectId);
    const current = this.requireCurrent(input.projectId, input.resourceId);
    this.requireRevision(current, input.expectedRevision);
    const event = this.eventHeader(
      input.projectId,
      input.resourceId,
      current.revision,
      "resource-deleted",
      {},
    );
    this.ctx.resourceStore.append(event);
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
    const resources = this.ctx.resourceStore.listStates(projectId)
      .filter((state): state is Extract<ResourceState, { status: "active" }> =>
        state.status === "active")
      .map(state => state.resource);
    return resources.length === 0
      ? emptyResources
      : Object.freeze(resources);
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
    return resources.length === 0
      ? emptyResources
      : Object.freeze(resources);
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
    const workspace = await this.requireWorkspace(projectId);
    return resolveResourceEntry(workspace, resource);
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

    const events: ResourceEvent[] = [];
    const states = new Map<ResourceId, ResourceState>();
    for (let index = 0; index < history.length; index += 1) {
      const event = this.parseEvent(projectId, history[index], index + 1, states);
      events.push(event);
      states.set(
        event.resourceId,
        projectResourceEvent(states.get(event.resourceId), event),
      );
    }

    const restored = this.ctx.resourceStore.restore(projectId, events);
    const active = restored
      .filter((state): state is Extract<ResourceState, { status: "active" }> =>
        state.status === "active")
      .map(state => state.resource);
    return active.length === 0 ? emptyResources : Object.freeze(active);
  }

  private parseEvent(
    projectId: ProjectId,
    raw: unknown,
    sequence: number,
    states: ReadonlyMap<ResourceId, ResourceState>,
  ): ResourceEvent {
    if (raw === null || typeof raw !== "object") throw invalidHistory();
    const value = raw as Record<string, unknown>;
    if (
      value.version !== 2
      || typeof value.id !== "string"
      || value.projectId !== projectId
      || typeof value.resourceId !== "string"
      || value.sequence !== sequence
      || !Number.isSafeInteger(value.revision)
      || !Number.isSafeInteger(value.baseRevision)
      || typeof value.timestamp !== "string"
      || Number.isNaN(Date.parse(value.timestamp))
      || value.data === null
      || typeof value.data !== "object"
    ) {
      throw invalidHistory();
    }

    const resourceId = createResourceId(value.resourceId);
    const header = {
      version: 2 as const,
      id: createEventId(value.id),
      projectId,
      resourceId,
      sequence,
      revision: value.revision as number,
      baseRevision: value.baseRevision as number,
      timestamp: value.timestamp,
    };
    const data = value.data as Record<string, unknown>;

    if (value.type === "resource-created") {
      if (typeof data.sourceNodeId !== "string") throw invalidHistory();
      const sourceNodeId = createNodeId(data.sourceNodeId);
      this.requireWorkNode(projectId, sourceNodeId);
      const metadata = this.validateMetadata({
        name: data.name,
        description: data.description,
        type: data.resourceType,
        entryRef: data.entryRef,
      });
      return freezeResourceEvent({
        ...header,
        type: "resource-created",
        data: {
          sourceNodeId,
          name: metadata.name,
          description: metadata.description,
          resourceType: metadata.type,
          entryRef: metadata.entryRef,
        },
      });
    }

    const current = states.get(resourceId);
    if (current === undefined || current.status !== "active") throw invalidHistory();

    if (value.type === "resource-updated") {
      if (data.changes === null || typeof data.changes !== "object") throw invalidHistory();
      const changes = this.validatePatch(data.changes as ResourceMetadataPatch, "invalid-history");
      if (Object.keys(changes).length === 0) throw invalidHistory();
      return freezeResourceEvent({
        ...header,
        type: "resource-updated",
        data: { changes },
      });
    }

    if (value.type === "resource-access-changed") {
      const access = this.parseHistoryAccess(data.access, current.resource.sourceNodeId);
      this.requireAccessNodes(projectId, access, "invalid-history");
      return freezeResourceEvent({
        ...header,
        type: "resource-access-changed",
        data: { access },
      });
    }

    if (
      value.type === "resource-deleted"
      && Object.keys(data).length === 0
    ) {
      return freezeResourceEvent({
        ...header,
        type: "resource-deleted",
        data: {},
      });
    }

    throw invalidHistory();
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

  private validateMetadata(input: {
    readonly name: unknown;
    readonly description: unknown;
    readonly type: unknown;
    readonly entryRef: unknown;
  }): {
    readonly name: string;
    readonly description: string;
    readonly type: string;
    readonly entryRef: string;
  } {
    return Object.freeze({
      name: this.requireText(input.name, "name"),
      description: this.requireText(input.description, "description"),
      type: this.requireText(input.type, "type"),
      entryRef: validateResourceEntryRef(input.entryRef),
    });
  }

  private validatePatch(
    input: ResourceMetadataPatch,
    code: "invalid-resource" | "invalid-history" = "invalid-resource",
  ): ResourceMetadataPatch {
    if (input === null || typeof input !== "object" || Array.isArray(input)) {
      throw new ResourceError(code, "Resource metadata patch is invalid.");
    }
    const keys = Object.keys(input);
    if (
      keys.length === 0
      || keys.some(key => !["name", "description", "type", "entryRef"].includes(key))
    ) {
      throw new ResourceError(code, "Resource metadata patch is invalid.");
    }

    try {
      return Object.freeze({
        ...(input.name === undefined
          ? {}
          : { name: this.requireText(input.name, "name") }),
        ...(input.description === undefined
          ? {}
          : { description: this.requireText(input.description, "description") }),
        ...(input.type === undefined
          ? {}
          : { type: this.requireText(input.type, "type") }),
        ...(input.entryRef === undefined
          ? {}
          : { entryRef: validateResourceEntryRef(input.entryRef) }),
      });
    } catch (error: unknown) {
      if (code === "invalid-history") {
        throw new ResourceError(code, "Resource history contains invalid metadata.", { cause: error });
      }
      throw error;
    }
  }

  private effectiveChanges(
    current: ProjectResource,
    changes: ResourceMetadataPatch,
  ): ResourceMetadataPatch {
    return Object.freeze({
      ...(changes.name !== undefined && changes.name !== current.name
        ? { name: changes.name }
        : {}),
      ...(changes.description !== undefined && changes.description !== current.description
        ? { description: changes.description }
        : {}),
      ...(changes.type !== undefined && changes.type !== current.type
        ? { type: changes.type }
        : {}),
      ...(changes.entryRef !== undefined && changes.entryRef !== current.entryRef
        ? { entryRef: changes.entryRef }
        : {}),
    });
  }

  private parseHistoryAccess(
    value: unknown,
    sourceNodeId: NodeId,
  ): ResourceAccess {
    if (value === null || typeof value !== "object") throw invalidHistory();
    const access = value as Record<string, unknown>;
    try {
      if (access.kind === "private" && Object.keys(access).length === 1) {
        return normalizeResourceAccess({ kind: "private" }, sourceNodeId);
      }
      if (access.kind === "project" && Object.keys(access).length === 1) {
        return normalizeResourceAccess({ kind: "project" }, sourceNodeId);
      }
      if (
        access.kind === "shared"
        && Object.keys(access).length === 2
        && Array.isArray(access.nodeIds)
        && access.nodeIds.every(nodeId => typeof nodeId === "string")
      ) {
        return normalizeResourceAccess({
          kind: "shared",
          nodeIds: access.nodeIds.map(nodeId => createNodeId(nodeId as string)),
        }, sourceNodeId);
      }
    } catch (error: unknown) {
      throw new ResourceError(
        "invalid-history",
        "Resource history contains invalid access.",
        { cause: error },
      );
    }
    throw invalidHistory();
  }

  private requireText(value: unknown, field: string): string {
    if (
      typeof value !== "string"
      || value.trim().length === 0
      || value.includes("\0")
    ) {
      throw new ResourceError(
        "invalid-resource",
        `Resource ${field} must be a non-empty string.`,
      );
    }
    return value;
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
    throw new ResourceError(
      "resource-unavailable",
      "Resource is unavailable.",
    );
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

  private requireWorkNode(projectId: ProjectId, nodeId: NodeId): void {
    const node = this.ctx.nodes.get(nodeId);
    if (
      node === undefined
      || node.node.projectId !== projectId
      || node.node.kind !== "work"
    ) {
      throw new ResourceError(
        "node-unavailable",
        "Resource Node must be a work Node in the same Project.",
      );
    }
  }

  private requireAccessNodes(
    projectId: ProjectId,
    access: ResourceAccess,
    errorCode: "invalid-access" | "invalid-history" = "invalid-access",
  ): void {
    if (access.kind !== "shared") return;
    try {
      for (const nodeId of access.nodeIds) this.requireWorkNode(projectId, nodeId);
    } catch (error: unknown) {
      throw new ResourceError(
        errorCode,
        "Shared Resource access contains an unavailable Node.",
        { cause: error },
      );
    }
  }

  private requireViewer(projectId: ProjectId, viewer: ResourceViewer): void {
    this.requireProject(projectId);
    if (viewer.kind === "node") this.requireWorkNode(projectId, viewer.nodeId);
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

function invalidHistory(): ResourceError {
  return new ResourceError(
    "invalid-history",
    "Resource history contains an invalid event.",
  );
}

declare module "cordis" {
  interface Context {
    resources: ResourceService;
  }
}
