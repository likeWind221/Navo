import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createMessageId, createSessionId, createTurnId } from "../../src/brand/ids.js";
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
