import { Service } from "cordis";
import type { Context } from "cordis";

import type { ProjectId, ResourceId } from "../brand/ids.js";
import { ResourceError } from "./errors.js";
import type { ResourceEvent } from "./events.js";
import { freezeResourceEvent } from "./events.js";
import {
  projectResourceEvent,
  type ResourceState,
} from "./projector.js";

const emptyHistory: readonly ResourceEvent[] = Object.freeze([]);
const emptyStates: readonly ResourceState[] = Object.freeze([]);

export class ResourceStore extends Service {
  private readonly histories = new Map<ProjectId, readonly ResourceEvent[]>();
  private readonly states = new Map<ResourceId, ResourceState>();
  private readonly orders = new Map<ProjectId, readonly ResourceId[]>();
  private readonly eventIds = new Set<string>();

  constructor(ctx: Context) {
    super(ctx, "resourceStore");
  }

  has(resourceId: ResourceId): boolean {
    return this.states.has(resourceId);
  }

  hasHistory(projectId: ProjectId): boolean {
    return this.histories.has(projectId);
  }

  getState(resourceId: ResourceId): ResourceState | undefined {
    return this.states.get(resourceId);
  }

  listStates(projectId: ProjectId): readonly ResourceState[] {
    const order = this.orders.get(projectId);
    if (order === undefined || order.length === 0) return emptyStates;
    return Object.freeze(order.map(resourceId => this.states.get(resourceId)!));
  }

  getEvents(projectId: ProjectId): readonly ResourceEvent[] {
    return this.histories.get(projectId) ?? emptyHistory;
  }

  append(event: ResourceEvent): ResourceState {
    const history = this.getEvents(event.projectId);
    if (event.sequence !== history.length + 1 || this.eventIds.has(event.id)) {
      throw new ResourceError(
        "invalid-history",
        "Resource event sequence or identity is invalid.",
      );
    }
    if (event.type === "resource-created" && this.states.has(event.resourceId)) {
      throw new ResourceError(
        "resource-already-exists",
        "Resource id is already owned.",
      );
    }

    const frozen = freezeResourceEvent(event);
    const state = projectResourceEvent(this.states.get(event.resourceId), frozen);
    this.histories.set(event.projectId, Object.freeze([...history, frozen]));
    this.states.set(event.resourceId, state);
    this.eventIds.add(frozen.id);
    if (frozen.type === "resource-created") {
      const order = this.orders.get(event.projectId) ?? Object.freeze([]);
      this.orders.set(event.projectId, Object.freeze([...order, event.resourceId]));
    }
    return state;
  }

  restore(
    projectId: ProjectId,
    events: readonly ResourceEvent[],
  ): readonly ResourceState[] {
    if (this.histories.has(projectId)) {
      throw new ResourceError(
        "registry-already-restored",
        "Cannot overwrite an existing Project Resource history.",
      );
    }

    const localStates = new Map<ResourceId, ResourceState>();
    const localEventIds = new Set<string>();
    const localOrder: ResourceId[] = [];
    const frozenEvents: ResourceEvent[] = [];

    for (let index = 0; index < events.length; index += 1) {
      const frozen = freezeResourceEvent(events[index]!);
      if (
        frozen.projectId !== projectId
        || frozen.sequence !== index + 1
        || localEventIds.has(frozen.id)
        || this.eventIds.has(frozen.id)
      ) {
        throw new ResourceError(
          "invalid-history",
          "Resource history contains an invalid event identity or sequence.",
        );
      }
      if (frozen.type === "resource-created") {
        if (localStates.has(frozen.resourceId) || this.states.has(frozen.resourceId)) {
          throw new ResourceError(
            "resource-already-exists",
            "Resource history contains an already-owned Resource id.",
          );
        }
        localOrder.push(frozen.resourceId);
      }
      const state = projectResourceEvent(localStates.get(frozen.resourceId), frozen);
      localStates.set(frozen.resourceId, state);
      localEventIds.add(frozen.id);
      frozenEvents.push(frozen);
    }

    this.histories.set(projectId, Object.freeze(frozenEvents));
    this.orders.set(projectId, Object.freeze(localOrder));
    for (const [resourceId, state] of localStates) this.states.set(resourceId, state);
    for (const eventId of localEventIds) this.eventIds.add(eventId);
    return Object.freeze(localOrder.map(resourceId => localStates.get(resourceId)!));
  }
}

declare module "cordis" {
  interface Context {
    resourceStore: ResourceStore;
  }
}
