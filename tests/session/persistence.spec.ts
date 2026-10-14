import type { Context } from "cordis";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { createMessageId, createNodeId, createSessionId, createStepId, createToolCallId, createTurnId } from "../../src/brand/ids.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import type { ReplayEnvelope } from "../../src/llm/types.js";
import { modelResponse } from "../helpers/runtime.js";
import { rawSql, removeRoots, storedRows, temporaryDatabase } from "../helpers/storage.js";

const contexts: Context[] = [];
const roots: string[] = [];
const done = () => modelResponse([{ type: "text", text: "Done" }]);
const search = () => modelResponse([{
  type: "tool-call", id: createToolCallId("search"), name: "web_search", arguments: '{"query":"Research"}',
}], "tool-calls");

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
  await removeRoots(roots);
});

async function open(path: string, entries: ConstructorParameters<typeof MockLLMAdapter>[0] = []) {
  let calls = 0;
  const ctx = await createApp({
    storage: { path }, node: { session: { model: { provider: "mock", model: "test" } } },
    tools: { search: { adapter: {
      id: "durability-probe",
      async search() {
        expect(storedRows(path, "session").at(-1)?.type).toBe("tool-call-requested");
        calls += 1;
        return { sources: [{ title: "Source", url: "https://example.com", summary: "Durable search result" }], truncated: false };
      },
    } } },
  });
  contexts.push(ctx);
  const adapter = new MockLLMAdapter(entries);
  ctx.llm.registerAdapter("mock", adapter);
  return { ctx, adapter, calls: () => calls };
}

async function close(ctx: Context) {
  contexts.splice(contexts.indexOf(ctx), 1);
  await ctx.fiber.dispose();
}

function storedHistory(path: string, projectId: string) {
  const db = new DatabaseSync(path);
  try {
    return db.prepare("SELECT * FROM events WHERE domain = 'session' AND project_id = ? ORDER BY seq").all(projectId);
  } finally {
    db.close();
  }
}

async function seed(entries: ConstructorParameters<typeof MockLLMAdapter>[0] = []) {
  const path = await temporaryDatabase(roots, "navo-session-");
  const kit = await open(path, entries);
  const project = kit.ctx.projects.create({ name: "Project", goal: "Continue research" });
  const nodeId = createNodeId("work");
  kit.ctx.roadmaps.create({
    definition: { projectId: project.id, nodes: [nodeId], edges: [] }, reason: "Approved",
    newNodes: [{ nodeId, input: { projectId: project.id,
      objective: { title: "Research", description: "Search", acceptanceCriteria: ["Sources found"] } } }],
  });
  return { ...kit, path, project, nodeId };
}

describe("Main and Node Session persistence", () => {
  it("restores complete histories and continues both original Sessions without replaying tools", async () => {
    const first = await seed([search(), done(), search(), done()]);
    const main = await first.ctx.mainSessions.sendMessage({ projectId: first.project.id, text: "Main question" });
    const node = await first.ctx.nodeSessions.start({ nodeId: first.nodeId, text: "Node question" });
    expect(first.calls()).toBe(2);
    const ids = [main.sessionId, node.sessionId];
    const events = ids.map(id => first.ctx.sessions.getEvents(id));
    const messages = ids.map(id => first.ctx.sessions.deriveMessages(id));
    expect(events.flat()).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "llm-requested" }),
      expect.objectContaining({ type: "tool-call-requested" }),
      expect.objectContaining({ type: "tool-call-result" }),
      expect.objectContaining({ type: "context-observed" }),
    ]));
    await close(first.ctx);

    const next = await open(first.path, [done(), done()]);
    expect(ids.map(id => next.ctx.sessions.getEvents(id))).toEqual(events);
    expect(ids.map(id => next.ctx.sessions.deriveMessages(id))).toEqual(messages);
    expect(next.calls()).toBe(0);
    expect(next.adapter.requests).toHaveLength(0);
    const continuedMain = await next.ctx.mainSessions.sendMessage({ projectId: first.project.id, text: "Continue Main" });
    const continuedNode = await next.ctx.nodeSessions.sendMessage({ nodeId: first.nodeId, text: "Continue Node" });
    expect([continuedMain.sessionId, continuedNode.sessionId]).toEqual(ids);
    for (const [index, request] of next.adapter.requests.entries()) {
      expect(request.messages.slice(1, -1)).toEqual(messages[index]);
      const history = next.ctx.sessions.getEvents(ids[index]!);
      expect(history.slice(0, events[index]!.length)).toEqual(events[index]);
      expect(history.map(event => event.sequence)).toEqual(history.map((_, position) => position + 1));
    }
    expect(next.calls()).toBe(0);
  });

  it("restores replacement surfaces and opaque Responses replay without duplicating old messages", async () => {
    const first = await seed();
    const id = first.project.mainSessionId;
    const a = first.ctx.sessions.append({ type: "user-message", sessionId: id,
      data: { message: { id: createMessageId("a"), role: "user", content: [{ type: "text", text: "Old" }] } } });
    const replay: ReplayEnvelope = { version: 1, protocol: "responses", source: { provider: "mock", model: "test" },
      items: [{ contentIndex: null, payload: { type: "reasoning", encrypted_content: "opaque", summary: [] } }] };
    first.ctx.sessions.append({ type: "assistant-message", sessionId: id,
      data: { turnId: createTurnId("turn"), stepId: "step" as never, finishReason: { kind: "stop" },
        message: { id: createMessageId("summary"), role: "assistant", content: [], replay } } },
    { op: "replace", start: a.sequence, end: a.sequence });
    const before = first.ctx.sessions.getEvents(id);
    await close(first.ctx);
    const next = await open(first.path, [done()]);
    expect(next.ctx.sessions.getEvents(id)).toEqual(before);
    const messages = next.ctx.sessions.deriveMessages(id);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.replay).toEqual(replay);
    expect(Object.isFrozen(messages[0]?.replay?.items[0]?.payload)).toBe(true);
    await next.ctx.mainSessions.sendMessage({ projectId: first.project.id, text: "Continue" });
    expect(next.adapter.requests[0]?.messages[1]).toEqual(messages[0]);
  });

  it("keeps memory, surface and observers unchanged when a replacement cannot be saved", async () => {
    const kit = await seed([done()]);
    await kit.ctx.mainSessions.sendMessage({ projectId: kit.project.id, text: "Keep" });
    const id = kit.project.mainSessionId;
    const events = kit.ctx.sessions.getEvents(id);
    const messages = kit.ctx.sessions.deriveMessages(id);
    const observed: unknown[] = [];
    kit.ctx.on("session/event", event => { observed.push(event); });
    rawSql(kit.path, "CREATE TRIGGER reject_session BEFORE INSERT ON events WHEN NEW.domain = 'session' BEGIN SELECT RAISE(ABORT, 'test failure'); END");
    expect(() => kit.ctx.sessions.append({ type: "user-message", sessionId: id,
      data: { message: { id: createMessageId("replacement"), role: "user", content: [{ type: "text", text: "Replace" }] } } },
    { op: "replace", start: 3, end: 3 })).toThrow();
    expect(kit.ctx.sessions.getEvents(id)).toEqual(events);
    expect(kit.ctx.sessions.deriveMessages(id)).toEqual(messages);
    expect(observed).toEqual([]);
    expect(storedRows(kit.path, "session")).toHaveLength(events.length);
  });

  it.each(["llm-requested", "tool-call-requested"])("blocks execution when %s cannot be saved", async type => {
    const kit = await seed([search(), done()]);
    rawSql(kit.path, `CREATE TRIGGER reject_checkpoint BEFORE INSERT ON events WHEN NEW.domain = 'session' AND json_extract(NEW.payload, '$.type') = '${type}' BEGIN SELECT RAISE(ABORT, 'test failure'); END`);
    const result = await kit.ctx.mainSessions.sendMessage({ projectId: kit.project.id, text: "Run" });
    expect(result.turn.status).toBe("failed");
    expect(kit.adapter.requests).toHaveLength(type === "llm-requested" ? 0 : 1);
    expect(kit.calls()).toBe(0);
    expect(kit.ctx.sessions.getEvents(result.sessionId).some(event => event.type === type)).toBe(false);
    expect(kit.ctx.projectRuntime.isMainActive(kit.project.id)).toBe(false);
  });

  it("closes an interrupted Main Turn before restoring it without executing work", async () => {
    const kit = await seed();
    const id = kit.project.mainSessionId;
    kit.ctx.sessions.append({ type: "turn-started", sessionId: id, data: { turnId: createTurnId("unfinished") } });
    await close(kit.ctx);
    const next = await open(kit.path);
    const repaired = next.ctx.sessions.getEvents(id);
    expect(repaired.map(event => event.type)).toEqual(["turn-started", "error", "turn-ended"]);
    expect(repaired[1]).toMatchObject({ data: { source: "runtime", failure: { code: "interrupted" } } });
    expect(repaired[2]).toMatchObject({ data: { status: "failed" } });
    expect(storedRows(kit.path, "session")).toHaveLength(3);
    expect(next.adapter.requests).toHaveLength(0);
    expect(next.ctx.projectRuntime.isMainActive(kit.project.id)).toBe(false);
    await close(next.ctx);
    const reopened = await open(kit.path);
    expect(reopened.ctx.sessions.getEvents(id)).toEqual(repaired);
  });

  it("closes an interrupted standalone Turn and restores its original identity", async () => {
    const kit = await seed();
    const id = createSessionId("standalone");
    kit.ctx.sessions.append({ type: "turn-started", sessionId: id, data: { turnId: createTurnId("temporary") } });
    await close(kit.ctx);
    const next = await open(kit.path);
    expect(next.ctx.sessions.getEvents(id)).toEqual([
      expect.objectContaining({ type: "turn-started" }),
      expect.objectContaining({ type: "error", data: expect.objectContaining({ failure: expect.objectContaining({ code: "interrupted" }) }) }),
      expect.objectContaining({ type: "turn-ended", data: expect.objectContaining({ status: "failed" }) }),
    ]);
    expect(next.adapter.requests).toHaveLength(0);
  });

  it("persists conservative results for interrupted tool calls without executing them", async () => {
    const kit = await seed();
    const id = kit.project.mainSessionId;
    const turnId = createTurnId("tool-turn");
    const stepId = createStepId("tool-step");
    const notStarted = createToolCallId("not-started");
    const unknown = createToolCallId("unknown");
    kit.ctx.sessions.append({ type: "turn-started", sessionId: id, data: { turnId } });
    kit.ctx.sessions.append({ type: "step-started", sessionId: id, data: { turnId, stepId } });
    kit.ctx.sessions.append({ type: "assistant-message", sessionId: id, data: {
      turnId, stepId, finishReason: { kind: "tool-calls" }, message: {
        id: createMessageId("tool-message"), role: "assistant", content: [
          { type: "tool-call", id: notStarted, name: "read", arguments: "{}" },
          { type: "tool-call", id: unknown, name: "write", arguments: "{}" },
        ],
      },
    } });
    kit.ctx.sessions.append({ type: "tool-call-requested", sessionId: id, data: {
      turnId, stepId, toolCall: { type: "tool-call", id: unknown, name: "write", arguments: "{}" },
    } });
    await close(kit.ctx);

    const next = await open(kit.path);
    const repaired = next.ctx.sessions.getEvents(id);
    const codes = repaired.filter(event => event.type === "error").map(event => event.data.failure.code);
    const messages = next.ctx.sessions.deriveMessages(id);

    expect(codes).toEqual(["tool-not-started", "tool-outcome-unknown", "interrupted"]);
    expect(messages.slice(-2).map(message => message.content[0])).toEqual([
      expect.objectContaining({ type: "tool-result", toolCallId: notStarted, isError: true }),
      expect.objectContaining({ type: "tool-result", toolCallId: unknown, isError: true }),
    ]);
    expect(next.calls()).toBe(0);
    expect(next.adapter.requests).toHaveLength(0);
  });

  it("closes an interrupted Node Turn and returns its working Node to idle atomically", async () => {
    const kit = await seed();
    const id = createSessionId("interrupted-node");
    kit.ctx.nodes.bindSession(kit.nodeId, id);
    kit.ctx.nodes.beginWork(kit.nodeId);
    kit.ctx.sessions.append({ type: "turn-started", sessionId: id, data: { turnId: createTurnId("node-turn") } });
    await close(kit.ctx);

    const next = await open(kit.path);

    expect(next.ctx.nodes.get(kit.nodeId)?.status).toBe("idle");
    expect(next.ctx.sessions.getEvents(id).at(-1)).toMatchObject({
      type: "turn-ended",
      data: { status: "failed" },
    });
    expect(storedRows(kit.path, "node").at(-1)).toMatchObject({ ownerId: kit.nodeId, type: "work-ended" });
  });

  it("returns a working Node to idle when its Session Turn was already durably closed", async () => {
    const kit = await seed();
    const id = createSessionId("closed-node");
    const turnId = createTurnId("closed-turn");
    kit.ctx.nodes.bindSession(kit.nodeId, id);
    kit.ctx.nodes.beginWork(kit.nodeId);
    kit.ctx.sessions.append({ type: "turn-started", sessionId: id, data: { turnId } });
    kit.ctx.sessions.append({ type: "turn-ended", sessionId: id, data: { turnId, status: "completed" } });
    const session = kit.ctx.sessions.getEvents(id);
    await close(kit.ctx);

    const next = await open(kit.path);

    expect(next.ctx.nodes.get(kit.nodeId)?.status).toBe("idle");
    expect(next.ctx.sessions.getEvents(id)).toEqual(session);
    expect(next.ctx.sessions.getEvents(id).some(event => event.type === "error")).toBe(false);
  });

  it("rolls back Session and Node recovery together when either append fails", async () => {
    const kit = await seed();
    const id = createSessionId("rollback-node");
    kit.ctx.nodes.bindSession(kit.nodeId, id);
    kit.ctx.nodes.beginWork(kit.nodeId);
    kit.ctx.sessions.append({ type: "turn-started", sessionId: id, data: { turnId: createTurnId("rollback-turn") } });
    await close(kit.ctx);
    const sessions = storedRows(kit.path, "session");
    const nodes = storedRows(kit.path, "node");
    rawSql(kit.path, "CREATE TRIGGER reject_recovery BEFORE INSERT ON events WHEN NEW.domain = 'node' AND json_extract(NEW.payload, '$.type') = 'work-ended' BEGIN SELECT RAISE(ABORT, 'test recovery failure'); END");

    await expect(open(kit.path)).rejects.toMatchObject({ code: "write-failed" });

    expect(storedRows(kit.path, "session")).toEqual(sessions);
    expect(storedRows(kit.path, "node")).toEqual(nodes);
  });

  it("keeps Project Sessions available when a standalone Session is corrupt", async () => {
    const kit = await seed();
    const plain = createSessionId("bad-plain");
    kit.ctx.sessions.append({ type: "user-message", sessionId: plain,
      data: { message: { id: createMessageId("plain"), role: "user", content: [{ type: "text", text: "Plain" }] } } });
    await close(kit.ctx);
    rawSql(kit.path, "UPDATE events SET payload = '{' WHERE owner_id = 'bad-plain'");
    const next = await open(kit.path, [done()]);
    expect(next.ctx.projects.get(kit.project.id)).toEqual(kit.project);
    await expect(next.ctx.mainSessions.sendMessage({ projectId: kit.project.id, text: "Continue" }))
      .resolves.toMatchObject({ turn: { status: "completed" } });
    expect(() => next.ctx.sessions.append({ type: "context-observed", sessionId: plain, data: { facts: [] } }))
      .toThrow(expect.objectContaining({ code: "session-unavailable" }));
  });

  it.each(["all", "second"] as const)("rejects Project identities presented as standalone or mixed ownership: %s", async mode => {
    const kit = await seed();
    const healthy = kit.ctx.projects.create({ name: "Healthy", goal: null });
    const id = kit.project.mainSessionId;
    for (const messageId of ["one", "two"]) {
      kit.ctx.sessions.append({ type: "user-message", sessionId: id,
        data: { message: { id: createMessageId(messageId), role: "user", content: [{ type: "text", text: messageId }] } } });
    }
    const plain = createSessionId("healthy-plain");
    const plainEvent = kit.ctx.sessions.append({ type: "user-message", sessionId: plain,
      data: { message: { id: createMessageId("plain"), role: "user", content: [{ type: "text", text: "Plain" }] } } });
    await close(kit.ctx);
    rawSql(kit.path, `UPDATE events SET project_id = NULL WHERE domain = 'session' AND owner_id = '${id}'${mode === "second" ? " AND seq = 2" : ""}`);
    const next = await open(kit.path, [done()]);
    expect(next.ctx.projects.get(kit.project.id)).toBeUndefined();
    expect(next.ctx.projects.get(healthy.id)).toBeDefined();
    expect(next.ctx.sessions.getEvents(plain)).toEqual([plainEvent]);
    await expect(next.ctx.agentRuntime.runTurn({ sessionId: id, model: { provider: "mock", model: "test" },
      userMessage: { id: createMessageId("reuse"), role: "user", content: [{ type: "text", text: "Reuse" }] } }))
      .rejects.toMatchObject({ code: "session-unavailable" });
    expect(next.adapter.requests).toHaveLength(0);
  });

  it.each([
    "UPDATE events SET payload = '{' WHERE domain = 'session'",
    "UPDATE events SET payload = json_set(payload, '$.sequence', 99) WHERE domain = 'session'",
    "UPDATE events SET payload = json_set(payload, '$.data.message.role', 'assistant') WHERE domain = 'session'",
    "UPDATE events SET payload = json_set(payload, '$.surfaceOp', json('{\"op\":\"replace\",\"start\":99,\"end\":99}')) WHERE domain = 'session'",
    "UPDATE events SET owner_id = 'unbound' WHERE domain = 'session'",
  ])("isolates corrupt Session history and leaves its stored data untouched: %s", async mutation => {
    const kit = await seed();
    const healthy = kit.ctx.projects.create({ name: "Healthy", goal: "Continue" });
    kit.ctx.sessions.append({ type: "user-message", sessionId: kit.project.mainSessionId,
      data: { message: { id: createMessageId("bad"), role: "user", content: [{ type: "text", text: "History" }] } } });
    await close(kit.ctx);
    rawSql(kit.path, mutation);
    const stored = storedHistory(kit.path, kit.project.id);
    const next = await open(kit.path, [done()]);
    expect(next.ctx.projects.get(kit.project.id)).toBeUndefined();
    expect(next.ctx.nodes.get(kit.nodeId)).toBeUndefined();
    expect(next.ctx.projects.get(healthy.id)).toBeDefined();
    expect(next.ctx.storage.recovery.failures).toEqual(expect.arrayContaining([
      expect.objectContaining({ projectId: kit.project.id, domain: "session" }),
    ]));
    await expect(next.ctx.mainSessions.sendMessage({ projectId: healthy.id, text: "Continue" }))
      .resolves.toMatchObject({ turn: { status: "completed" } });
    await close(next.ctx);
    expect(storedHistory(kit.path, kit.project.id)).toEqual(stored);
  });
});
