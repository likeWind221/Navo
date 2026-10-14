import { Context } from "cordis";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { createMessageId, createSessionId, createToolCallId } from "../../src/brand/ids.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import { SessionStore } from "../../src/session/store.js";
import { StorageService } from "../../src/storage/database.js";
import { modelResponse } from "../helpers/runtime.js";
import { rawSql, removeRoots, temporaryDatabase } from "../helpers/storage.js";

const contexts: Context[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
  await removeRoots(roots);
});

async function open(path: string, resolveProjectId?: (id: ReturnType<typeof createSessionId>) => string | null) {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(StorageService, { path });
  await ctx.plugin(SessionStore, { persistence: true, ...(resolveProjectId === undefined ? {} : { resolveProjectId }) });
  return ctx;
}

async function close(ctx: Context) {
  contexts.splice(contexts.indexOf(ctx), 1);
  await ctx.fiber.dispose();
}

function append(ctx: Context, id: string, text = "Original question") {
  return ctx.sessions.append({ type: "user-message", sessionId: createSessionId(id),
    data: { message: { id: createMessageId(`${id}-message`), role: "user", content: [{ type: "text", text }] } } });
}

function rows(path: string) {
  const db = new DatabaseSync(path);
  try {
    return db.prepare("SELECT * FROM events WHERE domain = 'session' ORDER BY owner_id, seq").all();
  } finally {
    db.close();
  }
}

describe("Standalone Session persistence", () => {
  it("saves without Project services and restores the same Surface and separate identities", async () => {
    const path = await temporaryDatabase(roots, "navo-standalone-");
    const ctx = await open(path);
    const first = append(ctx, "first");
    const replaced = append(ctx, "replace");
    ctx.sessions.append({ type: "user-message", sessionId: replaced.sessionId,
      data: { message: { id: createMessageId("replacement"), role: "user", content: [{ type: "text", text: "Replaced" }] } } },
    { op: "replace", start: replaced.sequence, end: replaced.sequence });
    const messages = ctx.sessions.deriveMessages(replaced.sessionId);
    await close(ctx);
    const restored = await open(path);
    expect(restored.sessions.getEvents(first.sessionId)).toEqual([first]);
    expect(restored.sessions.deriveMessages(replaced.sessionId)).toEqual(messages);
    expect(rows(path).every(row => row.project_id === null)).toBe(true);
  });

  it.each([
    "UPDATE events SET payload = '{' WHERE owner_id = 'bad'",
    "UPDATE events SET seq = 9 WHERE owner_id = 'bad'",
    "UPDATE events SET payload = json_set(payload, '$.sessionId', 'other') WHERE owner_id = 'bad'",
  ])("isolates bad standalone history and refuses reuse without changing stored rows: %s", async mutation => {
    const path = await temporaryDatabase(roots, "navo-standalone-isolation-");
    const ctx = await open(path);
    append(ctx, "bad");
    const healthy = append(ctx, "healthy");
    await close(ctx);
    rawSql(path, mutation);
    const original = rows(path);
    const restored = await open(path);
    expect(restored.sessions.getEvents(healthy.sessionId)).toEqual([healthy]);
    expect(restored.storage.recovery.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ kind: "session", sessionId: "bad" }),
    ]));
    expect(() => append(restored, "bad")).toThrow(expect.objectContaining({ code: "session-unavailable" }));
    expect(rows(path)).toEqual(original);
    expect(append(restored, "healthy").sequence).toBe(2);
  });

  it("refuses reassignment and write failures before memory or observers change", async () => {
    const path = await temporaryDatabase(roots, "navo-standalone-owner-");
    let projectId: string | null = null;
    const ctx = await open(path, () => projectId);
    const first = append(ctx, "session");
    let notified = 0;
    ctx.on("session/event", () => { notified += 1; });
    projectId = "p1";
    expect(() => append(ctx, "session")).toThrow(expect.objectContaining({ code: "invalid-record" }));
    projectId = null;
    rawSql(path, "CREATE TRIGGER fail_session BEFORE INSERT ON events BEGIN SELECT RAISE(ABORT, 'no save'); END");
    expect(() => append(ctx, "session")).toThrow(expect.objectContaining({ code: "write-failed" }));
    expect(ctx.sessions.getEvents(first.sessionId)).toEqual([first]);
    expect(ctx.sessions.deriveMessages(first.sessionId)).toHaveLength(1);
    expect(notified).toBe(0);
  });

  it("preserves standalone tool results in the next model request without executing them again", async () => {
    const path = await temporaryDatabase(roots, "navo-standalone-turn-");
    let calls = 0;
    const start = async (entries: ConstructorParameters<typeof MockLLMAdapter>[0]) => {
      const ctx = await createApp({ storage: { path }, node: { session: { model: { provider: "mock", model: "test" } } },
        tools: { search: { adapter: { id: "probe", async search() {
          calls += 1;
          expect(rows(path).at(-1)?.payload).toContain("tool-call-requested");
          return { sources: [], truncated: false };
        } } } } });
      contexts.push(ctx);
      const adapter = new MockLLMAdapter(entries);
      ctx.llm.registerAdapter("mock", adapter);
      return { ctx, adapter };
    };
    const done = () => modelResponse([{ type: "text", text: "Done" }]);
    const first = await start([modelResponse([{ type: "tool-call", id: createToolCallId("search"),
      name: "web_search", arguments: '{"query":"Research"}' }], "tool-calls"), done()]);
    const input = { sessionId: createSessionId("plain"), model: { provider: "mock", model: "test" }, toolNames: ["web_search"],
      userMessage: { id: createMessageId("first"), role: "user" as const, content: [{ type: "text" as const, text: "Research" }] } };
    await first.ctx.agentRuntime.runTurn(input);
    const messages = first.ctx.sessions.deriveMessages(input.sessionId);
    await close(first.ctx);
    const next = await start([done()]);
    expect(next.adapter.requests).toHaveLength(0);
    expect(calls).toBe(1);
    await next.ctx.agentRuntime.runTurn({ ...input,
      userMessage: { ...input.userMessage, id: createMessageId("next"), content: [{ type: "text", text: "Continue" }] } });
    expect(next.adapter.requests[0]!.messages.slice(0, -1)).toEqual(messages);
    expect(calls).toBe(1);
  });
});
