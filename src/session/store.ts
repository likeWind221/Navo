import { Service } from "cordis";
import type { Context } from "cordis";

import { createEventId } from "../brand/ids.js";
import type { SessionId } from "../brand/ids.js";
import type { SessionEvent } from "./types.js";

/** An event before the log assigns its identity, order, and commit time. */
export type SessionEventDraft<TEvent extends SessionEvent = SessionEvent> =
  TEvent extends SessionEvent
    ? Omit<TEvent, "id" | "sequence" | "timestamp">
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
  private readonly eventsBySession = new Map<SessionId, SessionEvent[]>();
  private eventCount = 0;

  constructor(ctx: Context) {
    super(ctx, "sessions");
  }

  append(draft: SessionEventDraft): SessionEvent {
    const events = this.eventsBySession.get(draft.sessionId) ?? [];
    const event = deepFreeze(
      structuredClone({
        ...draft,
        id: createEventId(`event-${++this.eventCount}`),
        sequence: events.length + 1,
        timestamp: new Date().toISOString(),
      }) as SessionEvent,
    );

    if (!this.eventsBySession.has(event.sessionId)) {
      this.eventsBySession.set(event.sessionId, events);
    }
    events.push(event);
    this.ctx.emit("session/event", event);
    return event;
  }

  getEvents(sessionId: SessionId): readonly SessionEvent[] {
    return Object.freeze([...(this.eventsBySession.get(sessionId) ?? [])]);
  }
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
