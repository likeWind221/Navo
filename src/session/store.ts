import { randomUUID } from "node:crypto";

import { Service } from "cordis";
import type { Context, Logger } from "cordis";

import { createEventId, createSessionId } from "../brand/ids.js";
import type { SessionId } from "../brand/ids.js";
import type { Message } from "../llm/types.js";
import { resolveAgentBinding } from "../project/binding.js";
import { parseSessionEvent, parseSessionHistory } from "./history.js";
import { applySurface, createSurface, eventMessage, withSystemPrompt } from "./surface.js";
import type { SurfaceState } from "./surface.js";
import type { SessionEvent, SurfaceOp } from "./types.js";

export interface SessionStoreConfig {
  readonly persistence: boolean;
}

/** An event before the log assigns its identity, order, and commit time. */
export type SessionEventDraft<TEvent extends SessionEvent = SessionEvent> =
  TEvent extends SessionEvent
    ? Omit<TEvent, "id" | "sequence" | "timestamp" | "surfaceOp">
    : never;

declare module "cordis" {
  interface Context {
    sessions: SessionStore;
  }

  interface Events {
    "session/event": (event: SessionEvent) => void;
  }
}

export class SessionStore extends Service {
  private readonly events = new Map<SessionId, SessionEvent[]>();
  private readonly surfaces = new Map<SessionId, SurfaceState>();
  private readonly logger: Logger;
  private persist: ((event: SessionEvent, apply: () => void) => void) | undefined;

  constructor(ctx: Context, config?: SessionStoreConfig) {
    super(ctx, "sessions");
    this.logger = ctx.logger("session");
    if (config?.persistence) {
      ctx.inject(["storage", "projects", "nodes"], scope => {
        for (const [sessionId, history] of scope.storage.recovery.events.get("session")!) {
          this.restore(createSessionId(sessionId), history.events);
        }
        this.persist = (event, apply) => {
          const binding = resolveAgentBinding(scope, event.sessionId);
          if (binding === undefined) {
            apply();
            return;
          }
          scope.storage.write(tx => tx.appendEvents({
            domain: "session", ownerId: event.sessionId, projectId: binding.projectId,
            firstSeq: event.sequence, events: [event],
          }), apply);
        };
        return () => { this.persist = undefined; };
      });
    }
  }

  append(draft: SessionEventDraft, surfaceOp?: SurfaceOp): SessionEvent {
    const events = this.events.get(draft.sessionId) ?? [];
    const event = parseSessionEvent(draft.sessionId, {
      ...draft,
      ...(surfaceOp === undefined ? {} : { surfaceOp }),
      id: createEventId(randomUUID()),
      sequence: events.length + 1,
      timestamp: new Date().toISOString(),
    }, events.length + 1);

    const current = this.surfaces.get(event.sessionId) ?? createSurface();
    const surface = { ...current, nodes: [...current.nodes] };
    applySurface(surface, event);
    const apply = () => {
      if (!this.events.has(event.sessionId)) this.events.set(event.sessionId, events);
      this.surfaces.set(event.sessionId, surface);
      events.push(event);
      this.publish(event);
    };
    if (this.persist === undefined) apply();
    else this.persist(event, apply);
    return event;
  }

  restore(sessionId: SessionId, history: readonly unknown[]): void {
    const events = parseSessionHistory(sessionId, history);
    const surface = createSurface();
    for (const event of events) applySurface(surface, event);
    this.events.set(sessionId, [...events]);
    this.surfaces.set(sessionId, surface);
  }

  getEvents(sessionId: SessionId): readonly SessionEvent[] {
    return Object.freeze([...(this.events.get(sessionId) ?? [])]);
  }

  /** Returns the current model-visible history through Session's cached surface. */
  deriveMessages(
    sessionId: SessionId,
    systemPrompt?: string,
  ): readonly Message[] {
    const events = this.events.get(sessionId) ?? [];
    const surface = this.surfaces.get(sessionId);
    if (!surface) return withSystemPrompt([], sessionId, systemPrompt);
    if (surface.derivedGeneration !== surface.generation) {
      surface.derived = [];
      surface.derivedNodes = 0;
      surface.derivedGeneration = surface.generation;
    }
    for (const sequence of surface.nodes.slice(surface.derivedNodes)) {
      const event = events[sequence - 1];
      if (!event) throw new Error(`Surface references missing event ${sequence}.`);
      const message = eventMessage(event);
      if (message) surface.derived.push(message);
    }
    surface.derivedNodes = surface.nodes.length;
    return withSystemPrompt(surface.derived, sessionId, systemPrompt);
  }

  /** Publishes an already committed fact without changing append's outcome. */
  private publish(event: SessionEvent): void {
    void this.ctx.parallel("session/event", event).catch((error: unknown) => {
      this.logger.warn(
        "session/event observers failed for %s:%d: %o",
        event.sessionId,
        event.sequence,
        error,
      );
    });
  }
}
