import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMessageId,
  createSessionId,
  createTurnId,
} from "../src/brand/ids.js";
import { SessionStore } from "../src/session/store.js";

const contexts = new Set<Context>();

function createContext(): Context {
  const ctx = new Context();
  contexts.add(ctx);
  return ctx;
}

afterEach(async () => {
  await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
  contexts.clear();
});

describe("SessionStore", () => {
  it("generates unique UUID event IDs across store instances", async () => {
    const firstContext = createContext();
    const secondContext = createContext();
    await Promise.all([
      firstContext.plugin(SessionStore),
      secondContext.plugin(SessionStore),
    ]);

    const first = firstContext.sessions.append({
      sessionId: createSessionId("session-first-store"),
      type: "turn-started",
      data: { turnId: createTurnId("turn-first-store") },
    });
    const second = secondContext.sessions.append({
      sessionId: createSessionId("session-second-store"),
      type: "turn-started",
      data: { turnId: createTurnId("turn-second-store") },
    });
    const uuidPattern =
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

    expect(first.id).toMatch(uuidPattern);
    expect(second.id).toMatch(uuidPattern);
    expect(first.id).not.toBe(second.id);
  });

  it("appends events in a strictly increasing order within each session", async () => {
    const ctx = createContext();
    await ctx.plugin(SessionStore);
    const firstSessionId = createSessionId("session-a");
    const secondSessionId = createSessionId("session-b");

    const first = ctx.sessions.append({
      sessionId: firstSessionId,
      type: "turn-started",
      data: { turnId: createTurnId("turn-a") },
    });
    const second = ctx.sessions.append({
      sessionId: firstSessionId,
      type: "turn-ended",
      data: { turnId: createTurnId("turn-a"), status: "completed" },
    });
    const otherSession = ctx.sessions.append({
      sessionId: secondSessionId,
      type: "turn-started",
      data: { turnId: createTurnId("turn-b") },
    });

    expect(ctx.sessions.getEvents(firstSessionId)).toEqual([first, second]);
    expect(ctx.sessions.getEvents(secondSessionId)).toEqual([otherSession]);
    expect([first.sequence, second.sequence]).toEqual([1, 2]);
    expect(otherSession.sequence).toBe(1);
  });

  it("detaches and deeply freezes committed events", async () => {
    const ctx = createContext();
    await ctx.plugin(SessionStore);
    const sessionId = createSessionId("session-immutable");
    const originalBlock = { type: "text" as const, text: "original" };
    const draft = {
      sessionId,
      type: "user-message" as const,
      data: {
        message: {
          id: createMessageId("message-user"),
          role: "user" as const,
          content: [originalBlock],
        },
      },
    };

    const committed = ctx.sessions.append(draft);
    originalBlock.text = "changed after append";
    const stored = ctx.sessions.getEvents(sessionId);

    expect(committed.type).toBe("user-message");
    if (committed.type !== "user-message") {
      throw new Error("expected a user-message event");
    }
    expect(committed.data.message.content).toEqual([
      { type: "text", text: "original" },
    ]);
    expect(Object.isFrozen(committed)).toBe(true);
    expect(Object.isFrozen(committed.data)).toBe(true);
    expect(Object.isFrozen(committed.data.message)).toBe(true);
    expect(Object.isFrozen(committed.data.message.content)).toBe(true);
    expect(Object.isFrozen(committed.data.message.content[0])).toBe(true);
    expect(Object.isFrozen(stored)).toBe(true);
    expect(() => (stored as typeof committed[]).push(committed)).toThrow(TypeError);
    expect(ctx.sessions.getEvents(sessionId)).toHaveLength(1);
  });

  it("publishes only after the event is committed", async () => {
    const ctx = createContext();
    await ctx.plugin(SessionStore);
    const sessionId = createSessionId("session-observed");
    let observedCommittedEvent: boolean | undefined;

    ctx.on("session/event", (event) => {
      const stored = ctx.sessions.getEvents(event.sessionId);
      observedCommittedEvent = stored.at(-1) === event;
    });

    ctx.sessions.append({
      sessionId,
      type: "turn-started",
      data: { turnId: createTurnId("turn-observed") },
    });

    expect(observedCommittedEvent).toBe(true);
  });

  it("registers and releases the service with its Cordis fiber", async () => {
    const ctx = createContext();
    const fiber = await ctx.plugin(SessionStore);

    expect(ctx.sessions).toBeInstanceOf(SessionStore);

    await fiber.dispose();

    expect(Reflect.get(ctx, "sessions")).toBeUndefined();
  });
});
