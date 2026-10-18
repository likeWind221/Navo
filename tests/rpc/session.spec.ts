import { describe, expect, it } from "vitest";

import {
  sessionContextFollowMethod,
  sessionContextMethod,
  sessionHistoryMethod,
} from "../../rpc/session.js";
import type { SessionContextSnapshotV1 } from "../../rpc/session.js";
import { RpcError } from "../../rpc/errors.js";

const snapshot: SessionContextSnapshotV1 = {
  sessionId: "session-1",
  eventSequence: 3,
  surfaceGeneration: 0,
  measuredAt: "2026-10-18T00:00:00.000Z",
  measurement: { usedTokens: 100, estimatedRequestTokens: 120, basis: "estimate" },
  budget: {
    kind: "enabled",
    contextWindow: 8_192,
    reservedOutputTokens: 1_024,
    thresholdTokens: 6_000,
    retainTokens: 512,
    exceeded: false,
  },
};

describe("F12.6 Session RPC contract", () => {
  it("uses versioned method names", () => {
    expect(sessionContextMethod.name).toBe("session.context.v1");
    expect(sessionContextFollowMethod.name).toBe("session.context.follow.v1");
    expect(sessionHistoryMethod.name).toBe("session.history.v1");
  });

  it("strictly validates unary inputs", () => {
    expect(sessionContextMethod.parseInput({ sessionId: "session-1" }))
      .toEqual({ sessionId: "session-1" });
    expect(sessionContextFollowMethod.parseInput({ sessionId: "session-1" }))
      .toEqual({ sessionId: "session-1" });
    expect(sessionHistoryMethod.parseInput({
      sessionId: "session-1", limit: 50, cursor: { surfaceGeneration: 2, offset: 7 },
    })).toEqual({
      sessionId: "session-1", limit: 50, cursor: { surfaceGeneration: 2, offset: 7 },
    });
    expect(sessionHistoryMethod.parseInput({ sessionId: "session-1", limit: 1 }))
      .toEqual({ sessionId: "session-1", limit: 1 });

    for (const invalid of [
      {}, { sessionId: "" }, { sessionId: "s", extra: true },
      { sessionId: "x".repeat(129) },
    ]) {
      expect(() => sessionContextMethod.parseInput(invalid)).toThrow(RpcError);
    }
    for (const limit of [0, 51, 1.5, "2", null]) {
      expect(() => sessionHistoryMethod.parseInput({ sessionId: "s", limit })).toThrow(RpcError);
    }
    expect(() => sessionHistoryMethod.parseInput({
      sessionId: "s", limit: 2, cursor: { surfaceGeneration: -1, offset: 0 },
    })).toThrow(RpcError);
    expect(() => sessionHistoryMethod.parseInput({
      sessionId: "s", limit: 2, cursor: { surfaceGeneration: 0, offset: 0, extra: 1 },
    })).toThrow(RpcError);
  });

  it("strictly validates context snapshots", () => {
    expect(sessionContextMethod.parseOutput(snapshot)).toEqual(snapshot);
    expect(sessionContextMethod.parseOutput({
      ...snapshot,
      budget: {
        kind: "enabled", contextWindow: undefined,
        reservedOutputTokens: 1, thresholdTokens: 2, retainTokens: 0, exceeded: true,
      },
    })).toMatchObject({ budget: { kind: "enabled", exceeded: true } });
    expect(sessionContextMethod.parseOutput({
      ...snapshot,
      budget: { kind: "disabled", reason: "missing-capacity" },
    })).toMatchObject({ budget: { kind: "disabled", reason: "missing-capacity" } });

    expect(() => sessionContextMethod.parseOutput({ ...snapshot, extra: 1 })).toThrow(RpcError);
    expect(() => sessionContextMethod.parseOutput({
      ...snapshot, measurement: { ...snapshot.measurement, basis: "exact" },
    })).toThrow(RpcError);
    expect(() => sessionContextMethod.parseOutput({ ...snapshot, measuredAt: "yesterday" }))
      .toThrow(RpcError);
    expect(() => sessionContextMethod.parseOutput({
      ...snapshot, budget: { kind: "disabled", reason: "other" },
    })).toThrow(RpcError);
  });

  it("strictly validates follow frames and compaction projections", () => {
    expect(sessionContextFollowMethod.parseOutput({ type: "snapshot", snapshot }))
      .toEqual({ type: "snapshot", snapshot });
    expect(sessionContextFollowMethod.parseOutput({ type: "context-updated", snapshot }))
      .toEqual({ type: "context-updated", snapshot });
    expect(sessionContextFollowMethod.parseOutput({
      type: "compaction-event",
      event: {
        kind: "started", sessionId: "session-1", sequence: 4,
        timestamp: "2026-10-18T00:00:00.000Z", compactionId: "c1",
        trigger: "manual", coveredStart: 1, coveredEnd: 2,
      },
    })).toMatchObject({ event: { kind: "started", trigger: "manual" } });
    expect(sessionContextFollowMethod.parseOutput({
      type: "compaction-event",
      event: {
        kind: "checkpoint", sessionId: "session-1", sequence: 5,
        timestamp: "2026-10-18T00:00:00.000Z", compactionId: "c1",
        coveredStart: 1, coveredEnd: 2, summaryVersion: 1, surfaceGeneration: 1,
      },
    })).toMatchObject({ event: { kind: "checkpoint", surfaceGeneration: 1 } });
    expect(sessionContextFollowMethod.parseOutput({
      type: "compaction-event",
      event: {
        kind: "ended", sessionId: "session-1", sequence: 6,
        timestamp: "2026-10-18T00:00:00.000Z", compactionId: "c1",
        status: "completed", beforeTokens: 10, afterTokens: 5,
        provider: "mock", model: "test",
      },
    })).toMatchObject({ event: { kind: "ended", status: "completed" } });

    expect(() => sessionContextFollowMethod.parseOutput({ type: "snapshot" })).toThrow(RpcError);
    expect(() => sessionContextFollowMethod.parseOutput({ type: "other", snapshot }))
      .toThrow(RpcError);
    expect(() => sessionContextFollowMethod.parseOutput({
      type: "compaction-event",
      event: {
        kind: "checkpoint", sessionId: "session-1", sequence: 5,
        timestamp: "2026-10-18T00:00:00.000Z", compactionId: "c1",
        coveredStart: 1, coveredEnd: 2, summaryVersion: 2, surfaceGeneration: 1,
      },
    })).toThrow(RpcError);
    expect(() => sessionContextFollowMethod.parseOutput({
      type: "compaction-event",
      event: {
        kind: "ended", sessionId: "session-1", sequence: 6,
        timestamp: "2026-10-18T00:00:00.000Z", compactionId: "c1",
        status: "completed", extra: true,
      },
    })).toThrow(RpcError);
  });

  it("requires a snapshot first and rejects another Session", () => {
    const validator = sessionContextFollowMethod.createOutputValidator!({ sessionId: "session-1" });
    expect(() => validator.parse({ type: "context-updated", snapshot })).toThrow(RpcError);
    expect(validator.parse({ type: "snapshot", snapshot })).toEqual({ type: "snapshot", snapshot });
    expect(() => validator.parse({
      type: "context-updated",
      snapshot: { ...snapshot, sessionId: "session-2" },
    })).toThrow(RpcError);

    const empty = sessionContextFollowMethod.createOutputValidator!({ sessionId: "session-1" });
    expect(() => empty.end()).toThrow(RpcError);
  });

  it("strictly validates effective history pages", () => {
    const page = {
      sessionId: "session-1",
      surfaceGeneration: 1,
      entries: [
        {
          kind: "message", sequence: 1, timestamp: "2026-10-18T00:00:00.000Z",
          message: {
            id: "m1", role: "user",
            content: [
              { type: "text", text: "hello" },
              { type: "reasoning", text: "think" },
              { type: "tool-call", id: "call-1", name: "read", arguments: "{}" },
              {
                type: "tool-result", toolCallId: "call-1", isError: false,
                content: [{ type: "text", text: "result" }],
              },
            ],
          },
        },
        {
          kind: "summary-checkpoint", sequence: 9, timestamp: "2026-10-18T00:00:01.000Z",
          message: { id: "m2", role: "user", content: [{ type: "text", text: "summary" }] },
          compactionId: "c1", coveredStart: 1, coveredEnd: 8, summaryVersion: 1,
        },
      ],
      nextCursor: { surfaceGeneration: 1, offset: 2 },
    };
    expect(sessionHistoryMethod.parseOutput(page)).toEqual(page);
    expect(sessionHistoryMethod.parseOutput({ ...page, nextCursor: null }))
      .toEqual({ ...page, nextCursor: null });

    expect(() => sessionHistoryMethod.parseOutput({ ...page, extra: 1 })).toThrow(RpcError);
    expect(() => sessionHistoryMethod.parseOutput({
      ...page, entries: [{ ...page.entries[0], kind: "summary" }],
    })).toThrow(RpcError);
    expect(() => sessionHistoryMethod.parseOutput({
      ...page, entries: [{ ...page.entries[0], sequence: 0 }],
    })).toThrow(RpcError);
    expect(() => sessionHistoryMethod.parseOutput({
      ...page,
      entries: [{
        ...page.entries[0],
        message: { id: "m1", role: "system", content: [] },
      }],
    })).toThrow(RpcError);
    expect(() => sessionHistoryMethod.parseOutput({
      ...page,
      entries: [{
        ...page.entries[1],
        summaryVersion: 2,
      }],
    })).toThrow(RpcError);
    expect(() => sessionHistoryMethod.parseOutput({
      ...page,
      entries: [{
        ...page.entries[0],
        message: { id: "m1", role: "user", content: [{ type: "image", text: "x" }] },
      }],
    })).toThrow(RpcError);
  });

  it("accepts exactly one unary output", () => {
    const validator = sessionContextMethod.createOutputValidator!({ sessionId: "session-1" });
    expect(validator.parse(snapshot)).toEqual(snapshot);
    expect(() => validator.parse(snapshot)).toThrow(RpcError);
    const empty = sessionHistoryMethod.createOutputValidator!({ sessionId: "s", limit: 1 });
    expect(() => empty.end()).toThrow(RpcError);
  });
});
