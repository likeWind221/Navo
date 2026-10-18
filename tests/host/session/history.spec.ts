import { describe, expect, it } from "vitest";

import { sessionHistoryMethod } from "../../../rpc/session.js";
import {
  appendAssistant,
  appendUser,
  call,
  compact,
  failureOf,
  host,
  seedConversation,
  session,
} from "./helpers.js";
import { modelResponse } from "../../helpers/runtime.js";

describe("Kernel Host session.history.v1", () => {
  it("pages the effective surface with original event sequences", async () => {
    const { ctx, client } = await host();
    const sessionId = session("history-pages");
    appendUser(ctx, sessionId, "history-user-1", "one");
    appendAssistant(ctx, sessionId, "history-assistant-1", "two");
    appendUser(ctx, sessionId, "history-user-2", "three");
    appendAssistant(ctx, sessionId, "history-assistant-2", "four");

    const first = await call(client, sessionHistoryMethod, { sessionId: String(sessionId), limit: 3 });
    expect(first).toMatchObject({ sessionId, surfaceGeneration: 0 });
    expect(first.entries.map(entry => [entry.kind, entry.sequence])).toEqual([
      ["message", 1], ["message", 2], ["message", 3],
    ]);
    expect(first.entries.map(entry => entry.message.id)).toEqual([
      "history-user-1", "history-assistant-1", "history-user-2",
    ]);
    expect(first.nextCursor).toEqual({ surfaceGeneration: 0, offset: 3 });

    const second = await call(client, sessionHistoryMethod, {
      sessionId: String(sessionId), limit: 3, cursor: first.nextCursor!,
    });
    expect(second.entries.map(entry => entry.message.id)).toEqual(["history-assistant-2"]);
    expect(second.nextCursor).toBeNull();

    const beyond = await call(client, sessionHistoryMethod, {
      sessionId: String(sessionId), limit: 2, cursor: { surfaceGeneration: 0, offset: 99 },
    });
    expect(beyond.entries).toEqual([]);
    expect(beyond.nextCursor).toBeNull();
  });

  it("keeps a cursor valid when messages are appended", async () => {
    const { ctx, client } = await host();
    const sessionId = session("history-stable");
    appendUser(ctx, sessionId, "stable-user-1", "one");
    appendAssistant(ctx, sessionId, "stable-assistant-1", "two");
    appendUser(ctx, sessionId, "stable-user-2", "three");
    const first = await call(client, sessionHistoryMethod, { sessionId: String(sessionId), limit: 2 });
    expect(first.nextCursor).toEqual({ surfaceGeneration: 0, offset: 2 });

    appendAssistant(ctx, sessionId, "stable-assistant-2", "four");

    const next = await call(client, sessionHistoryMethod, {
      sessionId: String(sessionId), limit: 2, cursor: first.nextCursor!,
    });
    expect(next.surfaceGeneration).toBe(0);
    expect(next.entries.map(entry => entry.message.id)).toEqual([
      "stable-user-2", "stable-assistant-2",
    ]);
  });

  it("returns an empty page for an empty Session", async () => {
    const { client } = await host();
    const page = await call(client, sessionHistoryMethod, { sessionId: "history-empty", limit: 50 });
    expect(page).toEqual({
      sessionId: "history-empty",
      surfaceGeneration: 0,
      entries: [],
      nextCursor: null,
    });
  });

  it("maps a compaction checkpoint to a summary entry and invalidates older cursors", async () => {
    const { ctx, client } = await host([
      modelResponse([{ type: "text", text: "## Summary\n- Keep the task." }]),
    ]);
    const sessionId = session("history-compacted");
    seedConversation(ctx, sessionId, 8, 1_200);
    const before = await call(client, sessionHistoryMethod, { sessionId: String(sessionId), limit: 2 });
    expect(before.nextCursor).toEqual({ surfaceGeneration: 0, offset: 2 });

    await compact(ctx, sessionId);

    const failure = await failureOf(client, sessionHistoryMethod, {
      sessionId: String(sessionId), limit: 2, cursor: before.nextCursor!,
    });
    expect(failure).toMatchObject({ code: "history-changed" });
    expect(failure?.details).toMatchObject({ surfaceGeneration: 1 });

    const page = await call(client, sessionHistoryMethod, { sessionId: String(sessionId), limit: 50 });
    expect(page.surfaceGeneration).toBe(1);
    const checkpoint = page.entries[0];
    expect(checkpoint).toMatchObject({
      kind: "summary-checkpoint",
      summaryVersion: 1,
    });
    if (checkpoint?.kind !== "summary-checkpoint") return;
    expect(checkpoint.coveredStart).toBe(1);
    expect(checkpoint.coveredEnd).toBeGreaterThanOrEqual(1);
    expect(checkpoint.compactionId.length).toBeGreaterThan(0);
    expect(checkpoint.message.content[0]).toMatchObject({ type: "text" });
    expect(page.entries.slice(1).every(entry => entry.kind === "message")).toBe(true);
    const surface = ctx.sessions.getSurfaceSnapshot(sessionId);
    expect(page.entries.map(entry => entry.sequence)).toEqual(
      surface.entries.flatMap(entry => entry.message === undefined ? [] : [entry.sequence]),
    );
    expect(page.entries.some(entry => entry.message.id === "seed-user-0")).toBe(false);
  });

  it("rejects limits outside the public range at the RPC boundary", async () => {
    const { client } = await host();
    await expect(call(client, sessionHistoryMethod, { sessionId: "history-limit", limit: 0 }))
      .rejects.toMatchObject({ code: "invalid-frame" });
    await expect(call(client, sessionHistoryMethod, {
      sessionId: "history-limit", limit: 1, cursor: { surfaceGeneration: 0, offset: -1 },
    })).rejects.toMatchObject({ code: "invalid-frame" });
  });
});
