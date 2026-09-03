import { randomUUID } from "node:crypto";

import { Service } from "cordis";
import type { Context, Logger } from "cordis";

import { createEventId, createMessageId } from "../brand/ids.js";
import type { SessionId } from "../brand/ids.js";
import type { Message } from "../llm/types.js";
import type { SessionEvent, SurfaceOp } from "./types.js";

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

/** In-memory, append-only session log exposed as `ctx.sessions`. */
export class SessionStore extends Service {
  private readonly events = new Map<SessionId, SessionEvent[]>();
  private readonly surfaces = new Map<SessionId, SurfaceState>();
  private readonly logger: Logger;

  constructor(ctx: Context) {
    super(ctx, "sessions");
    this.logger = ctx.logger("session");
  }

  append(draft: SessionEventDraft, surfaceOp?: SurfaceOp): SessionEvent {
    const events = this.events.get(draft.sessionId) ?? [];
    const event = deepFreeze(
      structuredClone({
        ...draft,
        ...(surfaceOp === undefined ? {} : { surfaceOp }),
        id: createEventId(randomUUID()),
        sequence: events.length + 1,
        timestamp: new Date().toISOString(),
      }) as SessionEvent,
    );

    const surface = this.surfaces.get(event.sessionId) ?? createSurface();
    applySurface(surface, event);
    if (!this.events.has(event.sessionId)) {
      this.events.set(event.sessionId, events);
      this.surfaces.set(event.sessionId, surface);
    }
    events.push(event);
    this.publish(event);
    return event;
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

interface SurfaceState {
  readonly nodes: number[];
  derived: Message[];
  derivedNodes: number;
  generation: number;
  derivedGeneration: number;
}

function createSurface(): SurfaceState {
  return { nodes: [], derived: [], derivedNodes: 0, generation: 0, derivedGeneration: 0 };
}

function applySurface(surface: SurfaceState, event: SessionEvent): void {
  if (!isMessageEvent(event)) {
    if (event.surfaceOp !== undefined) throw new TypeError("Log-only events cannot alter the model surface.");
    return;
  }
  const op = event.surfaceOp ?? "append";
  if (op === "append") {
    surface.nodes.push(event.sequence);
    return;
  }
  const start = surface.nodes.indexOf(op.start);
  const end = surface.nodes.indexOf(op.end);
  if (start < 0 || end < start) throw new RangeError("Surface replacement bounds must name an ordered current range.");
  surface.nodes.splice(start, end - start + 1, event.sequence);
  surface.generation += 1;
}

function isMessageEvent(event: SessionEvent): boolean {
  return event.type === "user-message" || event.type === "assistant-message" || event.type === "tool-call-result";
}

function eventMessage(event: SessionEvent): Message | undefined {
  switch (event.type) {
    case "user-message":
    case "tool-call-result":
      return event.data.message;
    case "assistant-message":
      return event.data.message.content.length === 0 ? undefined : event.data.message;
    default:
      return undefined;
  }
}

function withSystemPrompt(
  messages: readonly Message[],
  sessionId: SessionId,
  systemPrompt: string | undefined,
): readonly Message[] {
  if (systemPrompt === undefined) return Object.freeze([...messages]);
  return Object.freeze([{
    id: createMessageId(`system-${sessionId}`),
    role: "system",
    content: [{ type: "text", text: systemPrompt }],
  }, ...messages]);
}

function deepFreeze<TValue>(
  value: TValue,
  seen = new Set<object>(),
): TValue {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return value;
  }

  seen.add(value);
  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value) as TValue;
}
