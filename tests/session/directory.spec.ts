import { afterEach, describe, expect, it } from "vitest";
import type { Context } from "cordis";

import { createApp } from "../../src/app.js";
import { createMessageId, createSessionId } from "../../src/brand/ids.js";
import { createAgentTurnHandler } from "../../src/host/turn.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import { removeRoots, temporaryDatabase } from "../helpers/storage.js";

const contexts: Context[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
  await removeRoots(roots);
});

async function app(path: string): Promise<Context> {
  const ctx = await createApp({
    storage: { path },
    node: { session: { model: { provider: "mock", model: "test" } } },
  });
  contexts.push(ctx);
  return ctx;
}

describe("ordinary Session directory", () => {
  it("creates, pages, renames, archives, and restores without creating Turn history", async () => {
    const path = await temporaryDatabase(roots, "navo-ordinary-directory-");
    const ctx = await app(path);
    const first = ctx.sessionDirectory.create("First");
    const second = ctx.sessionDirectory.create("Second");

    const page = ctx.sessionDirectory.list({ query: "", status: "all", limit: 1 });
    expect(page.entries).toHaveLength(1);
    expect(page.nextCursor).not.toBeNull();
    const next = ctx.sessionDirectory.list({ query: "", status: "all", limit: 1, cursor: page.nextCursor! });
    expect(next.entries).toHaveLength(1);
    expect(new Set([page.entries[0]!.sessionId, next.entries[0]!.sessionId])).toEqual(
      new Set([String(first.sessionId), String(second.sessionId)]),
    );
    expect(ctx.sessions.getEvents(first.sessionId)).toEqual([]);

    const renamed = ctx.sessionDirectory.rename(first.sessionId, "Renamed", first.revision);
    expect(renamed.title).toBe("Renamed");
    expect(() => ctx.sessionDirectory.rename(first.sessionId, "Stale", first.revision))
      .toThrow(expect.objectContaining({ code: "session-revision-conflict" }));
    const archived = ctx.sessionDirectory.archive(first.sessionId, renamed.revision);
    expect(archived.status).toBe("archived");
    expect(ctx.sessionDirectory.list({ query: "renamed", status: "active", limit: 10 }).entries).toEqual([]);
    const restored = ctx.sessionDirectory.restore(first.sessionId, archived.revision);
    expect(restored.status).toBe("active");
    await ctx.fiber.dispose();
    contexts.splice(contexts.indexOf(ctx), 1);
    const reopened = await app(path);
    expect(reopened.sessionDirectory.list({ query: "renamed", status: "active", limit: 10 }).entries)
      .toMatchObject([{ sessionId: String(first.sessionId), title: "Renamed", status: "active" }]);
  });

  it("keeps queued Turn and compact leases visible to archive checks", async () => {
    const path = await temporaryDatabase(roots, "navo-ordinary-activity-");
    const ctx = await app(path);
    const session = ctx.sessionDirectory.create("Busy");
    const releaseTurn = ctx.sessionDirectory.beginActivity(session.sessionId)!;
    const releaseCompact = ctx.sessionDirectory.beginActivity(session.sessionId)!;

    expect(() => ctx.sessionDirectory.archive(session.sessionId, session.revision))
      .toThrow(expect.objectContaining({ code: "session-active" }));
    releaseTurn();
    expect(() => ctx.sessionDirectory.archive(session.sessionId, session.revision))
      .toThrow(expect.objectContaining({ code: "session-active" }));
    releaseCompact();
    expect(ctx.sessionDirectory.archive(session.sessionId, session.revision).status).toBe("archived");
    expect(() => ctx.sessionDirectory.beginActivity(session.sessionId))
      .toThrow(expect.objectContaining({ code: "session-archived" }));
  });

  it("keeps an active and a queued Turn visible to archive checks", async () => {
    const path = await temporaryDatabase(roots, "navo-ordinary-turns-");
    const ctx = await app(path);
    ctx.llm.registerAdapter("mock", new MockLLMAdapter([{ kind: "hang" }, { kind: "hang" }]));
    const session = ctx.sessionDirectory.create("Turns");
    const handler = createAgentTurnHandler(ctx, { model: { provider: "mock", model: "test" } });
    const firstAbort = new AbortController();
    const first = handler({ sessionId: String(session.sessionId), requestId: "first", text: "one" }, firstAbort.signal)
      [Symbol.asyncIterator]();
    await expect(first.next()).resolves.toMatchObject({ value: { type: "started" } });
    expect(() => ctx.sessionDirectory.archive(session.sessionId, session.revision))
      .toThrow(expect.objectContaining({ code: "session-active" }));

    const secondAbort = new AbortController();
    const second = handler({ sessionId: String(session.sessionId), requestId: "second", text: "two" }, secondAbort.signal)
      [Symbol.asyncIterator]();
    const secondNext = second.next();
    await Promise.resolve();
    expect(() => ctx.sessionDirectory.archive(session.sessionId, session.revision))
      .toThrow(expect.objectContaining({ code: "session-active" }));

    firstAbort.abort();
    await first.return?.(undefined);
    await expect(secondNext).resolves.toMatchObject({ value: { type: "started" } });
    expect(() => ctx.sessionDirectory.archive(session.sessionId, session.revision))
      .toThrow(expect.objectContaining({ code: "session-active" }));

    secondAbort.abort();
    await second.return?.(undefined);
    expect(ctx.sessionDirectory.archive(session.sessionId, session.revision).status).toBe("archived");
  });

  it("migrates recoverable standalone history on restart and excludes Project Main", async () => {
    const path = await temporaryDatabase(roots, "navo-ordinary-migration-");
    const first = await app(path);
    const legacy = createSessionId("legacy-ordinary");
    first.sessions.append({
      type: "user-message", sessionId: legacy,
      data: { message: { id: createMessageId("legacy-message"), role: "user", content: [{ type: "text", text: "old" }] } },
    });
    const project = first.projects.create({ name: "Owned", goal: null });
    const node = first.nodes.create({
      projectId: project.id,
      objective: { title: "Node", description: "Do work", acceptanceCriteria: ["Done"] },
    });
    first.nodes.unlock(node.node.id, "test");
    const nodeSession = createSessionId("owned-node");
    first.sessions.append({
      type: "user-message", sessionId: nodeSession,
      data: { message: { id: createMessageId("owned-node-message"), role: "user", content: [{ type: "text", text: "node" }] } },
    });
    first.nodes.bindSession(node.node.id, nodeSession);
    expect(first.sessionDirectory.list({ query: "", status: "all", limit: 50 }).entries
      .some(entry => entry.sessionId === String(project.mainSessionId))).toBe(false);
    expect(() => first.sessionDirectory.rename(project.mainSessionId, "No", 1))
      .toThrow(expect.objectContaining({ code: "session-not-ordinary" }));
    expect(() => first.sessionDirectory.rename(nodeSession, "No", 1))
      .toThrow(expect.objectContaining({ code: "session-not-ordinary" }));
    await first.fiber.dispose();
    contexts.splice(contexts.indexOf(first), 1);

    const restarted = await app(path);
    const entry = restarted.sessionDirectory.list({ query: "", status: "all", limit: 50 }).entries
      .find(item => item.sessionId === String(legacy));
    expect(entry).toMatchObject({ sessionId: String(legacy), title: "Untitled conversation", status: "active" });
    expect(restarted.sessionDirectory.list({ query: "", status: "all", limit: 50 }).entries
      .some(item => item.sessionId === String(nodeSession))).toBe(false);
  });
});
