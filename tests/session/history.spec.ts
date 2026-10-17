import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createEventId, createMessageId, createSessionId, createTurnId } from "../../src/brand/ids.js";
import { parseSessionHistory } from "../../src/session/history.js";
import { SessionStore } from "../../src/session/store.js";

const id = createSessionId("history");
const ctx = new Context();
await ctx.plugin(SessionStore);
afterEach(() => { ctx.sessions.restore(id, []); });

function event() {
  return ctx.sessions.append({ type: "user-message", sessionId: id,
    data: { message: { id: createMessageId("question"), role: "user", content: [{ type: "text", text: "Question" }] } } });
}

describe("Session history validation", () => {
  it.each([
    { sequence: 2 }, { sessionId: "another" }, { id: "" }, { timestamp: "not-a-date" },
    { type: "unknown" }, { type: { toString: "invalid" } },
    { data: { message: { id: "m", role: { toString: "user" }, content: [] } } },
    { data: { message: { id: "m", role: "user", content: [{ type: "unknown" }] } } },
    { data: { message: { id: "m", role: "assistant", content: [] } } },
    { data: { message: { id: "m", role: "user", content: [], replay: { version: 2 } } } },
    { surfaceOp: { op: "replace", start: 1, end: 1 } },
  ])("rejects malformed stored data without replacing an existing history: %j", changes => {
    const before = event();
    expect(() => ctx.sessions.restore(id, [{ ...before, ...changes }])).toThrow(expect.objectContaining({ code: "invalid-history" }));
    expect(ctx.sessions.getEvents(id)).toEqual([before]);
    expect(ctx.sessions.deriveMessages(id)[0]?.content).toEqual([{ type: "text", text: "Question" }]);
  });

  it("rejects duplicate event IDs", () => {
    const first = event();
    expect(() => parseSessionHistory(id, [first, { ...first, sequence: 2 }]))
      .toThrow(expect.objectContaining({ code: "invalid-history" }));
  });

  it.each([NaN, Infinity, undefined, 1n, new Date(), () => undefined])("rejects non-JSON data before appending: %s", detail => {
    expect(() => ctx.sessions.append({ type: "error", sessionId: id,
      data: { turnId: createTurnId("t"), source: "runtime", failure: { code: "test", message: "Failure", details: detail as never } } }))
      .toThrow(expect.objectContaining({ code: "invalid-history" }));
    expect(ctx.sessions.getEvents(id)).toEqual([]);
  });

  it("rejects cyclic data without changing the log", () => {
    const details: Record<string, unknown> = {};
    details.self = details;
    expect(() => ctx.sessions.append({ type: "error", sessionId: id,
      data: { turnId: createTurnId("t"), source: "runtime", failure: { code: "test", message: "Failure", details: details as never } } }))
      .toThrow(expect.objectContaining({ code: "invalid-history" }));
    expect(ctx.sessions.getEvents(id)).toEqual([]);
  });

  it("restores history silently and detaches the restored values", () => {
    const original = structuredClone(event());
    let observed = 0;
    const dispose = ctx.on("session/event", () => { observed += 1; });
    ctx.sessions.restore(id, [original]);
    if (original.type === "user-message") Reflect.set(original.data.message, "content", []);
    expect(ctx.sessions.deriveMessages(id)[0]?.content).toHaveLength(1);
    expect(observed).toBe(0);
    dispose();
  });
});

describe("Session compaction history validation", () => {
  const compactionSession = createSessionId("compaction-history");
  const timestamp = "2026-10-17T10:00:00.000Z";

  function envelope(
    type: string,
    data: Record<string, unknown>,
    sequence: number,
    surfaceOp?: Record<string, unknown>,
  ): Record<string, unknown> {
    return {
      id: createEventId(`compaction-event-${sequence}`),
      sessionId: compactionSession,
      sequence,
      timestamp,
      type,
      data,
      ...(surfaceOp === undefined ? {} : { surfaceOp }),
    };
  }

  function userMessage(sequence: number): Record<string, unknown> {
    return envelope("user-message", {
      message: {
        id: createMessageId("compaction-user"),
        role: "user",
        content: [{ type: "text", text: "history" }],
      },
    }, sequence);
  }

  function checkpoint(sequence: number): Record<string, unknown> {
    return envelope("compaction-checkpoint", {
      compactionId: "manual-compaction",
      message: {
        id: createMessageId("compaction-checkpoint"),
        role: "user",
        content: [{ type: "text", text: "<compacted-summary>summary</compacted-summary>" }],
      },
      coveredStart: 1,
      coveredEnd: 1,
      summaryVersion: 1,
    }, sequence, { op: "replace", start: 1, end: 1 });
  }

  it("accepts a manual transaction without Turn identity and keeps old triggers valid", () => {
    const manual = [
      userMessage(1),
      envelope("compaction-started", {
        compactionId: "manual-compaction",
        trigger: "manual",
        coveredStart: 1,
        coveredEnd: 1,
      }, 2),
      checkpoint(3),
      envelope("compaction-ended", {
        compactionId: "manual-compaction",
        status: "completed",
        beforeTokens: 100,
        afterTokens: 20,
      }, 4),
    ];
    expect(parseSessionHistory(compactionSession, manual)).toHaveLength(4);

    const legacy = [
      envelope("compaction-started", {
        turnId: createTurnId("legacy-turn"),
        compactionId: "legacy-compaction",
        trigger: "overflow",
        coveredStart: 1,
        coveredEnd: 1,
      }, 1),
      envelope("compaction-ended", {
        turnId: createTurnId("legacy-turn"),
        compactionId: "legacy-compaction",
        status: "interrupted",
      }, 2),
    ];
    expect(parseSessionHistory(compactionSession, legacy)).toHaveLength(2);
  });

  it("rejects a manual transaction that claims a Turn", () => {
    const history = [
      userMessage(1),
      envelope("compaction-started", {
        turnId: createTurnId("wrong-turn"),
        compactionId: "manual-compaction",
        trigger: "manual",
        coveredStart: 1,
        coveredEnd: 1,
      }, 2),
    ];
    expect(() => parseSessionHistory(compactionSession, history))
      .toThrow(expect.objectContaining({ code: "invalid-history" }));
  });

  it("still requires a Turn for pressure and overflow transactions", () => {
    const history = [
      userMessage(1),
      envelope("compaction-started", {
        compactionId: "pressure-compaction",
        trigger: "pressure",
        coveredStart: 1,
        coveredEnd: 1,
      }, 2),
    ];
    expect(() => parseSessionHistory(compactionSession, history))
      .toThrow(expect.objectContaining({ code: "invalid-history" }));
  });
});
