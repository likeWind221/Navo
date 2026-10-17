import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { createMessageId, createSessionId, createStepId, createToolCallId, createTurnId } from "../../src/brand/ids.js";
import type { Message, UserMessage } from "../../src/llm/types.js";
import { selectCompactablePrefix } from "../../src/context/compaction/selector.js";
import { SessionStore } from "../../src/session/store.js";

function message(role: "user" | "assistant", text: string, id: string): Message {
  return { id: createMessageId(id), role, content: [{ type: "text", text }] };
}

function entry(sequence: number, value?: Message) {
  return { sequence, ...(value === undefined ? {} : { message: value }) };
}

describe("context compaction selection", () => {
  it("selects a useful prefix while retaining the recent tail", () => {
    const entries = [
      entry(1, message("user", "a".repeat(800), "u1")),
      entry(2, message("assistant", "b".repeat(800), "a1")),
      entry(3, message("user", "c".repeat(800), "u2")),
      entry(4, message("assistant", "d".repeat(800), "a2")),
      entry(5, message("user", "recent", "u3")),
    ];
    const selected = selectCompactablePrefix(entries, 10, 500, 100);
    expect(selected?.coveredStart).toBe(1);
    expect(selected?.coveredEnd).toBe(2);
    expect(selected?.retainedTokens).toBeGreaterThanOrEqual(10);
  });

  it("never cuts between a tool call and its result", () => {
    const callId = createToolCallId("call-1");
    const entries = [
      entry(1, message("user", "a".repeat(800), "u1")),
      entry(2, {
        id: createMessageId("assistant-call"),
        role: "assistant",
        content: [{ type: "tool-call" as const, id: callId, name: "read", arguments: "{}" }],
      }),
      entry(3, message("assistant", "after tool", "a1")),
      entry(4, {
        id: createMessageId("tool-result"),
        role: "user",
        content: [{ type: "tool-result" as const, toolCallId: callId, isError: false, content: [{ type: "text" as const, text: "ok" }] }],
      }),
      entry(5, message("user", "tail", "u2")),
    ];
    const selected = selectCompactablePrefix(entries, 1, 10_000, 1);
    expect(selected?.coveredEnd).toBe(4);
  });

  it("returns no selection when no safe boundary or useful prefix exists", () => {
    const entries = [
      entry(1, message("user", "short", "u1")),
      entry(2, message("assistant", "short", "a1")),
      entry(3, message("user", "tail", "u2")),
    ];
    expect(selectCompactablePrefix(entries, 1, 10, 100)).toBeUndefined();
  });
});

describe("Session compaction checkpoint", () => {
  it("replays the checkpoint surface while retaining the original event log", async () => {
    const ctx = new Context();
    await ctx.plugin(SessionStore);
    const sessionId = createSessionId("checkpoint-session");
    const turnId = createTurnId("turn-1");
    const stepId = createStepId("step-1");
    const originalUserId = createMessageId("original-user");
    const first = ctx.sessions.append({
      type: "user-message",
      sessionId,
      data: { message: { id: originalUserId, role: "user", content: [{ type: "text", text: "original" }] } },
    });
    ctx.sessions.append({
      type: "assistant-message",
      sessionId,
      data: { turnId, stepId, message: { id: createMessageId("original-answer"), role: "assistant", content: [{ type: "text", text: "answer" }] },
        finishReason: { kind: "stop" } },
    });
    const tailMessageId = createMessageId("tail-user");
    ctx.sessions.append({
      type: "user-message",
      sessionId,
      data: { message: { id: tailMessageId, role: "user", content: [{ type: "text", text: "tail" }] } },
    });
    const snapshot = ctx.sessions.getSurfaceSnapshot(sessionId);
    const checkpoint: UserMessage = { id: createMessageId("checkpoint"), role: "user",
      content: [{ type: "text", text: "<compacted-summary>summary</compacted-summary>" }] };
    ctx.sessions.appendCompactionCheckpoint({
      type: "compaction-checkpoint",
      sessionId,
      data: { turnId, compactionId: "compact-1", message: checkpoint, coveredStart: first.sequence,
        coveredEnd: snapshot.sequences[1]!, summaryVersion: 1 },
    }, snapshot, first.sequence, snapshot.sequences[1]!);

    expect(ctx.sessions.deriveMessages(sessionId).map(item => item.id))
      .toEqual([checkpoint.id, tailMessageId]);
    const events = ctx.sessions.getEvents(sessionId);
    expect(events.some(event => event.type === "user-message" && event.data.message.id === originalUserId)).toBe(true);
    const recovery = new Context();
    await recovery.plugin(SessionStore);
    recovery.sessions.restore(sessionId, events);
    expect(recovery.sessions.deriveMessages(sessionId).map(item => item.id))
      .toEqual([checkpoint.id, tailMessageId]);
    await Promise.all([ctx.fiber.dispose(), recovery.fiber.dispose()]);
  });

  it("rejects a stale selection if the surface changes during summarization", async () => {
    const ctx = new Context();
    await ctx.plugin(SessionStore);
    const sessionId = createSessionId("stale-checkpoint-session");
    const turnId = createTurnId("turn-stale");
    const first = ctx.sessions.append({
      type: "user-message",
      sessionId,
      data: { message: { id: createMessageId("stale-original"), role: "user", content: [{ type: "text", text: "original" }] } },
    });
    const second = ctx.sessions.append({
      type: "user-message",
      sessionId,
      data: { message: { id: createMessageId("stale-second"), role: "user", content: [{ type: "text", text: "second" }] } },
    });
    const snapshot = ctx.sessions.getSurfaceSnapshot(sessionId);
    ctx.sessions.append({
      type: "user-message",
      sessionId,
      data: { message: { id: createMessageId("stale-third"), role: "user", content: [{ type: "text", text: "new" }] } },
    });
    expect(() => ctx.sessions.appendCompactionCheckpoint({
      type: "compaction-checkpoint",
      sessionId,
      data: { turnId, compactionId: "compact-stale", message: { id: createMessageId("stale-checkpoint"), role: "user", content: [{ type: "text", text: "summary" }] },
        coveredStart: first.sequence, coveredEnd: second.sequence, summaryVersion: 1 },
    }, snapshot, first.sequence, second.sequence)).toThrow("context-compaction-stale-selection");
    await ctx.fiber.dispose();
  });
});
