import type { ProjectId, ResourceId } from "../brand/ids.js";
import type { StorageService, StorageTransaction } from "../storage/database.js";
import { ResourceError } from "./errors.js";
import type { ResourceEvent } from "./events.js";
import { freezeResourceEvent } from "./events.js";
import { libraryPathKey } from "./library.js";
import {
  projectResourceEvent,
  type ResourceState,
} from "./projector.js";

const emptyHistory: readonly ResourceEvent[] = Object.freeze([]);
const emptyStates: readonly ResourceState[] = Object.freeze([]);

export class ResourceStore {
  constructor(
    private readonly storage: StorageService,
    private readonly onAppend: (projectId: ProjectId) => void,
  ) {}

  private readonly histories = new Map<ProjectId, readonly ResourceEvent[]>();
  private readonly states = new Map<ResourceId, ResourceState>();
  private readonly orders = new Map<ProjectId, readonly ResourceId[]>();
  private readonly eventIds = new Set<string>();

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
    return this.appendMany([event])[0]!;
  }

  appendMany(events: readonly ResourceEvent[], persist?: (tx: StorageTransaction) => void): readonly ResourceState[] {
    if (events.length === 0) {
      if (persist !== undefined) this.storage.atomic(persist);
      return [];
    }
    const projectId = events[0]!.projectId;
    const history = this.getEvents(projectId);
    const staged = new Map<ResourceId, ResourceState>();
    const frozenEvents: ResourceEvent[] = [];
    const identities = new Set<string>();
    for (const event of events) {
      if (event.projectId !== projectId || event.sequence !== history.length + frozenEvents.length + 1
        || this.eventIds.has(event.id) || identities.has(event.id)) {
        throw new ResourceError("invalid-history", "Resource event sequence or identity is invalid.");
      }
      if (event.type === "resource-created" && this.states.has(event.resourceId)) {
        throw new ResourceError("resource-already-exists", "Resource id is already owned.");
      }
      const frozen = freezeResourceEvent(event);
      const state = projectResourceEvent(staged.get(event.resourceId) ?? this.states.get(event.resourceId), frozen);
      staged.set(event.resourceId, state);
      frozenEvents.push(frozen);
      identities.add(frozen.id);
    }
    const active = [...this.listStates(projectId).filter(state => state.status === "active")]
      .filter(state => !staged.has(state.resource.id)).concat([...staged.values()].filter(state => state.status === "active"));
    const paths = new Set<string>();
    for (const state of active) {
      const key = libraryPathKey(state.resource.libraryPath);
      if (paths.has(key) || [...paths].some(path => path.startsWith(`${key}/`) || key.startsWith(`${path}/`))) {
        throw new ResourceError("resource-already-exists", "Logical Resource path conflicts with another file.");
      }
      paths.add(key);
    }
    const results = frozenEvents.map(event => staged.get(event.resourceId)!);
    this.storage.atomic(tx => {
      tx.bumpCatalogVersion(projectId);
      persist?.(tx);
      this.storage.write(inner => inner.appendEvents({ domain: "resource", ownerId: projectId,
        projectId, firstSeq: history.length + 1, events: frozenEvents }), () => {
        this.histories.set(projectId, Object.freeze([...history, ...frozenEvents]));
        for (const [id, state] of staged) this.states.set(id, state);
        for (const event of frozenEvents) this.eventIds.add(event.id);
        const created = frozenEvents.filter(event => event.type === "resource-created").map(event => event.resourceId);
        if (created.length) this.orders.set(projectId, Object.freeze([...(this.orders.get(projectId) ?? []), ...created]));
        this.onAppend(projectId);
      });
    });
    return results;
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
