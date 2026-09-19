import { randomUUID } from "node:crypto";

import { Service } from "cordis";
import type { Context } from "cordis";

import {
  createEventId,
  createNodeId,
  createResourceId,
} from "../brand/ids.js";
import type {
  ProjectId,
  ResourceId,
} from "../brand/ids.js";
import { ResourceError } from "./errors.js";
import type { ResourceEvent } from "./events.js";
import type {
  CreateResourceInput,
  ProjectResource,
} from "./model.js";

const emptyHistory: readonly ResourceEvent[] = Object.freeze([]);
const emptyResources: readonly ProjectResource[] = Object.freeze([]);

export class ResourceStore extends Service {
  static inject = ["projects", "nodes", "projectWorkspaces"];

  private readonly histories = new Map<ProjectId, readonly ResourceEvent[]>();
  private readonly byId = new Map<ResourceId, ProjectResource>();

  constructor(ctx: Context) {
    super(ctx, "resources");
  }

  async create(input: CreateResourceInput): Promise<ProjectResource> {
    this.requireActiveProject(input.projectId);
    this.requireSourceNode(input.projectId, input.sourceNodeId);
    const metadata = this.validateMetadata(input);

    const target = await this.ctx.projectWorkspaces.resolve(input.projectId, metadata.ref);
    if (!target.exists) {
      throw new ResourceError(
        "resource-target-missing",
        "Resource registration requires an existing Project Workspace target.",
      );
    }

    // Filesystem resolution is asynchronous. Re-check the mutable Project gate
    // before committing the registration fact.
    this.requireActiveProject(input.projectId);

    let resourceId: ResourceId;
    do resourceId = createResourceId(randomUUID());
    while (this.byId.has(resourceId));

    const history = this.getEvents(input.projectId);
    const event = this.freezeEvent({
      version: 1,
      id: createEventId(randomUUID()),
      projectId: input.projectId,
      resourceId,
      sequence: history.length + 1,
      timestamp: new Date().toISOString(),
      type: "resource-registered",
      data: {
        sourceNodeId: input.sourceNodeId,
        title: metadata.title,
        description: metadata.description,
        resourceType: metadata.type,
        ref: metadata.ref,
      },
    });
    const resource = this.project(event);
    this.histories.set(input.projectId, Object.freeze([...history, event]));
    this.byId.set(resource.id, resource);
    return resource;
  }

  get(projectId: ProjectId, resourceId: ResourceId): ProjectResource | undefined {
    this.requireProject(projectId);
    const resource = this.byId.get(resourceId);
    if (resource === undefined) return undefined;
    if (resource.projectId !== projectId) {
      throw new ResourceError(
        "resource-unavailable",
        "Resource does not belong to the requested Project.",
      );
    }
    return resource;
  }

  listByProject(projectId: ProjectId): readonly ProjectResource[] {
    this.requireProject(projectId);
    const history = this.histories.get(projectId);
    if (history === undefined || history.length === 0) return emptyResources;
    return Object.freeze(history.map(event => this.byId.get(event.resourceId)!));
  }

  getEvents(projectId: ProjectId): readonly ResourceEvent[] {
    return this.histories.get(projectId) ?? emptyHistory;
  }

  async restore(
    projectId: ProjectId,
    history: readonly unknown[],
  ): Promise<readonly ProjectResource[]> {
    if (this.histories.has(projectId)) {
      throw new ResourceError(
        "registry-already-restored",
        "Cannot overwrite an existing Project Resource Registry.",
      );
    }
    this.requireProject(projectId);

    const localIds = new Set<ResourceId>();
    const localEventIds = new Set<string>();
    const events: ResourceEvent[] = [];
    const resources: ProjectResource[] = [];

    for (let index = 0; index < history.length; index += 1) {
      const event = await this.parseEvent(projectId, history[index], index + 1);
      if (localEventIds.has(event.id)) {
        throw new ResourceError(
          "invalid-history",
          "Resource history contains a duplicate event id.",
        );
      }
      if (localIds.has(event.resourceId) || this.byId.has(event.resourceId)) {
        throw new ResourceError(
          "resource-already-exists",
          "Resource history contains an already-owned Resource id.",
        );
      }
      localEventIds.add(event.id);
      localIds.add(event.resourceId);
      events.push(event);
      resources.push(this.project(event));
    }

    const frozenEvents = Object.freeze(events);
    const frozenResources = Object.freeze(resources);
    this.histories.set(projectId, frozenEvents);
    for (const resource of frozenResources) this.byId.set(resource.id, resource);
    return frozenResources;
  }

  private async parseEvent(
    projectId: ProjectId,
    raw: unknown,
    expectedSequence: number,
  ): Promise<ResourceEvent> {
    if (!raw || typeof raw !== "object") {
      throw new ResourceError(
        "invalid-history",
        "Resource history contains an invalid event.",
      );
    }
    const value = raw as Record<string, unknown>;
    const data = value.data;
    if (
      value.version !== 1
      || typeof value.id !== "string"
      || value.projectId !== projectId
      || typeof value.resourceId !== "string"
      || value.sequence !== expectedSequence
      || typeof value.timestamp !== "string"
      || Number.isNaN(Date.parse(value.timestamp))
      || value.type !== "resource-registered"
      || !data
      || typeof data !== "object"
    ) {
      throw new ResourceError(
        "invalid-history",
        "Resource history contains an invalid event envelope.",
      );
    }

    const record = data as Record<string, unknown>;
    if (typeof record.sourceNodeId !== "string") {
      throw new ResourceError(
        "invalid-history",
        "Resource history contains an invalid source Node.",
      );
    }
    const sourceNodeId = createNodeId(record.sourceNodeId);
    this.requireSourceNode(projectId, sourceNodeId);
    const metadata = this.validateMetadata({
      title: record.title,
      description: record.description,
      type: record.resourceType,
      ref: record.ref,
    });

    // Replay validates the ref against the current Project boundary but does
    // not require the file to still exist. Resource metadata is durable fact;
    // content availability is checked again when a future consumer reads it.
    await this.ctx.projectWorkspaces.resolve(projectId, metadata.ref);

    return this.freezeEvent({
      version: 1,
      id: createEventId(value.id),
      projectId,
      resourceId: createResourceId(value.resourceId),
      sequence: expectedSequence,
      timestamp: value.timestamp,
      type: "resource-registered",
      data: {
        sourceNodeId,
        title: metadata.title,
        description: metadata.description,
        resourceType: metadata.type,
        ref: metadata.ref,
      },
    });
  }

  private validateMetadata(input: {
    readonly title: unknown;
    readonly description: unknown;
    readonly type: unknown;
    readonly ref: unknown;
  }): {
    readonly title: string;
    readonly description: string;
    readonly type: string;
    readonly ref: string;
  } {
    const title = this.requireText(input.title, "title");
    const description = this.requireText(input.description, "description");
    const type = this.requireText(input.type, "type");
    const ref = this.requireText(input.ref, "ref");
    return Object.freeze({ title, description, type, ref });
  }

  private requireText(value: unknown, field: string): string {
    if (typeof value !== "string" || value.trim().length === 0 || value.includes("\0")) {
      throw new ResourceError(
        "invalid-resource",
        `Resource ${field} must be a non-empty string.`,
      );
    }
    return value;
  }

  private requireProject(projectId: ProjectId): void {
    if (this.ctx.projects.get(projectId) === undefined) {
      throw new ResourceError(
        "project-unavailable",
        "Resource Registry requires an existing Project.",
      );
    }
  }

  private requireActiveProject(projectId: ProjectId): void {
    if (this.ctx.projects.get(projectId)?.status !== "active") {
      throw new ResourceError(
        "project-unavailable",
        "Resource registration requires an active Project.",
      );
    }
  }

  private requireSourceNode(projectId: ProjectId, sourceNodeId: ReturnType<typeof createNodeId>): void {
    const node = this.ctx.nodes.get(sourceNodeId);
    if (!node || node.node.projectId !== projectId || node.node.kind !== "work") {
      throw new ResourceError(
        "node-unavailable",
        "Resource source must be a work Node in the same Project.",
      );
    }
  }

  private project(event: ResourceEvent): ProjectResource {
    return Object.freeze({
      id: event.resourceId,
      projectId: event.projectId,
      sourceNodeId: event.data.sourceNodeId,
      sequence: event.sequence,
      createdAt: event.timestamp,
      title: event.data.title,
      description: event.data.description,
      type: event.data.resourceType,
      ref: event.data.ref,
    });
  }

  private freezeEvent(event: ResourceEvent): ResourceEvent {
    return Object.freeze({
      ...event,
      data: Object.freeze({ ...event.data }),
    });
  }
}

declare module "cordis" {
  interface Context {
    resources: ResourceStore;
  }
}
