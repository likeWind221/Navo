import { afterEach, describe, expect, it } from "vitest";

import { createAgentTurnV2Handler } from "../../../../src/host/turn/v2.js";
import { createToolCallId } from "../../../../src/brand/ids.js";
import {
  createRuntime,
  disposeRuntimes,
} from "../../../helpers/runtime.js";

afterEach(disposeRuntimes);

const model = { provider: "mock", model: "test" };
const config = { model };

async function collectV2(
  kit: Awaited<ReturnType<typeof createRuntime>>,
  input: { sessionId: string; requestId: string; text: string },
  signal?: AbortSignal,
): Promise<unknown[]> {
  const handler = createAgentTurnV2Handler(kit.ctx, config);
  const iterator = handler(input, signal ?? new AbortController().signal)[Symbol.asyncIterator]();
  const events: unknown[] = [];
  for (;;) {
    const next = await iterator.next();
    if (next.done) break;
    events.push(next.value);
  }
  return events;
}

function reasoningThenText() {
  return {
    kind: "events" as const,
    events: [
      { type: "content-started" as const, contentIndex: 0, contentType: "reasoning" as const },
      { type: "content-delta" as const, contentIndex: 0, contentType: "reasoning" as const, delta: "let me think " },
      { type: "content-delta" as const, contentIndex: 0, contentType: "reasoning" as const, delta: "about it" },
      { type: "content-completed" as const, contentIndex: 0, contentType: "reasoning" as const },
      { type: "content-started" as const, contentIndex: 1, contentType: "text" as const },
      { type: "content-delta" as const, contentIndex: 1, contentType: "text" as const, delta: "hello " },
      { type: "content-delta" as const, contentIndex: 1, contentType: "text" as const, delta: "world" },
      { type: "content-completed" as const, contentIndex: 1, contentType: "text" as const },
      { type: "finished" as const, reason: { kind: "stop" as const } },
    ],
  };
}

describe("Kernel Host agent.turn.v2", () => {
  it("emits the full ordered v2 stream: turn, step, reasoning, text, terminal", async () => {
    const kit = await createRuntime([reasoningThenText()]);
    const events = await collectV2(kit, {
      sessionId: "v2-session",
      requestId: "v2-request",
      text: "hi",
    });
    const types = events.map((event) => (event as { type: string }).type);
    expect(types).toEqual([
      "turn-started",
      "step-started",
      "content-started",
      "content-delta",
      "content-delta",
      "content-completed",
      "content-started",
      "content-delta",
      "content-delta",
      "content-completed",
      "step-completed",
      "turn-completed",
    ]);
    const first = events[0] as { type: string; turnId: string };
    const step = events[1] as { type: string; stepId: string; messageId: string };
    const reasoningStart = events[2] as { type: string; contentIndex: number; kind: string };
    const textStart = events[6] as { type: string; contentIndex: number; kind: string };
    const completed = events.at(-1) as { type: string };
    expect(first.turnId).toBeTruthy();
    expect(step.stepId).toBeTruthy();
    expect(step.messageId).toBeTruthy();
    expect(reasoningStart.kind).toBe("reasoning");
    expect(textStart.kind).toBe("text");
    expect(reasoningStart.contentIndex).not.toBe(textStart.contentIndex);
    expect(completed.type).toBe("turn-completed");
    // Every event carries the same session/request/turn identity.
    for (const event of events) {
      const scope = event as { sessionId: string; requestId: string; turnId: string };
      expect(scope.sessionId).toBe("v2-session");
      expect(scope.requestId).toBe("v2-request");
      expect(scope.turnId).toBe(first.turnId);
    }
  });

  it("keeps reasoning separate from visible text", async () => {
    const kit = await createRuntime([reasoningThenText()]);
    const events = await collectV2(kit, {
      sessionId: "reasoning-session",
      requestId: "reasoning-request",
      text: "think",
    });
    const deltas = events
      .filter((event) => (event as { type: string }).type === "content-delta")
      .map((event) => event as { contentIndex: number; delta: string });
    // The reasoning block's deltas come before the text block's.
    const reasoningDeltas = deltas
      .filter((delta) => delta.contentIndex === (events[2] as { contentIndex: number }).contentIndex)
      .map((delta) => delta.delta);
    const textDeltas = deltas
      .filter((delta) => delta.contentIndex === (events[6] as { contentIndex: number }).contentIndex)
      .map((delta) => delta.delta);
    expect(reasoningDeltas.join("")).toBe("let me think about it");
    expect(textDeltas.join("")).toBe("hello world");
  });

  it("maps an aborted in-flight stream to turn-cancelled", async () => {
    const kit = await createRuntime([
      {
        kind: "hang" as const,
        eventsBeforeHang: [
          { type: "content-started" as const, contentIndex: 0, contentType: "text" as const },
          { type: "content-delta" as const, contentIndex: 0, contentType: "text" as const, delta: "partial" },
        ],
      },
    ]);
    const controller = new AbortController();
    const handler = createAgentTurnV2Handler(kit.ctx, config);
    const iterator = handler({
      sessionId: "cancel-v2",
      requestId: "cancel-v2-req",
      text: "stop",
    }, controller.signal)[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "turn-started" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "step-started" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "content-started" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "content-delta" },
    });
    controller.abort("user stop");
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "content-completed" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "step-completed" },
    });
    await expect(iterator.next()).resolves.toMatchObject({
      value: { type: "turn-cancelled" },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("maps a provider error after visible output to one turn-failed terminal", async () => {
    const kit = await createRuntime([
      {
        kind: "error" as const,
        eventsBeforeError: [
          { type: "content-started" as const, contentIndex: 0, contentType: "text" as const },
          { type: "content-delta" as const, contentIndex: 0, contentType: "text" as const, delta: "visible" },
        ],
        error: new Error("socket failed"),
      },
    ]);
    const events = await collectV2(kit, {
      sessionId: "fail-v2",
      requestId: "fail-v2-req",
      text: "fail",
    });
    const types = events.map((event) => (event as { type: string }).type);
    expect(types).toEqual([
      "turn-started",
      "step-started",
      "content-started",
      "content-delta",
      "content-completed",
      "step-completed",
      "turn-failed",
    ]);
    const terminal = events.at(-1) as { type: string; failure: { code: string } };
    expect(terminal.type).toBe("turn-failed");
    expect(terminal.failure.code).toBe("stream-output-interrupted");
  });

  it("maps a max-tokens finish to turn-truncated", async () => {
    const kit = await createRuntime([
      {
        kind: "events" as const,
        events: [
          { type: "content-started" as const, contentIndex: 0, contentType: "text" as const },
          { type: "content-delta" as const, contentIndex: 0, contentType: "text" as const, delta: "truncated " },
          { type: "content-delta" as const, contentIndex: 0, contentType: "text" as const, delta: "content" },
          { type: "content-completed" as const, contentIndex: 0, contentType: "text" as const },
          { type: "finished" as const, reason: { kind: "max-tokens" as const } },
        ],
      },
      {
        kind: "events" as const,
        events: [
          { type: "content-started" as const, contentIndex: 0, contentType: "text" as const },
          { type: "content-delta" as const, contentIndex: 0, contentType: "text" as const, delta: "tail" },
          { type: "content-completed" as const, contentIndex: 0, contentType: "text" as const },
          { type: "finished" as const, reason: { kind: "stop" as const } },
        ],
      },
    ]);
    const events = await collectV2(kit, {
      sessionId: "truncate-v2",
      requestId: "truncate-v2-req",
      text: "truncate",
    });
    const terminal = events.at(-1) as { type: string };
    expect(terminal.type).toBe("turn-truncated");
  });

  it("forwards rejected tool calls and reuses content indexes across Steps", async () => {
    const toolCallId = createToolCallId("call-1");
    const kit = await createRuntime([
      {
        kind: "events" as const,
        events: [
          { type: "content-started" as const, contentIndex: 0,
            contentType: "tool-call" as const, toolCallId },
          { type: "content-delta" as const, contentIndex: 0,
            contentType: "tool-call" as const, toolCallId,
            toolNameDelta: "read", delta: "{}" },
          { type: "content-completed" as const, contentIndex: 0,
            contentType: "tool-call" as const },
          { type: "finished" as const, reason: { kind: "tool-calls" as const } },
        ],
      },
      {
        kind: "events" as const,
        events: [
          { type: "content-started" as const, contentIndex: 0,
            contentType: "text" as const },
          { type: "content-delta" as const, contentIndex: 0,
            contentType: "text" as const, delta: "done" },
          { type: "content-completed" as const, contentIndex: 0,
            contentType: "text" as const },
          { type: "finished" as const, reason: { kind: "stop" as const } },
        ],
      },
    ]);
    const events = await collectV2(kit, {
      sessionId: "tool-call-session",
      requestId: "tool-call-request",
      text: "call",
    });

    expect(events.map((event) => (event as { type: string }).type)).toEqual([
      "turn-started",
      "step-started",
      "content-started",
      "content-delta",
      "content-completed",
      "tool-result",
      "step-completed",
      "step-started",
      "content-started",
      "content-delta",
      "content-completed",
      "step-completed",
      "turn-completed",
    ]);
    expect(events[2]).toMatchObject({
      type: "content-started",
      kind: "tool-call",
      toolCallId,
      toolName: "read",
    });
    expect(events[3]).toMatchObject({ type: "content-delta", delta: "{}" });
    expect(events[5]).toMatchObject({
      type: "tool-result",
      toolCallId,
      status: "failed",
      failure: { code: "tool-not-allowed" },
    });
  });
});
