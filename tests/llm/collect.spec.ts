import { describe, expect, it } from "vitest";

import { createToolCallId } from "../../src/brand/ids.js";
import { collectStream } from "../../src/llm/collect.js";
import type { FinishReason, ModelEvent } from "../../src/llm/types.js";

describe("collectStream", () => {
  it.each<FinishReason>([
    { kind: "error", failure: { code: "SERVER", message: "original", status: 503 } },
    { kind: "error", failure: { code: "TIMEOUT", message: "original timeout" } },
    { kind: "cancelled" },
  ])("preserves $kind and drops nameless interrupted tool calls", async (reason) => {
    const events: ModelEvent[] = [
      { type: "content-started", contentIndex: 0, contentType: "text" },
      { type: "content-delta", contentIndex: 0, contentType: "text", delta: "prefix" },
      { type: "content-started", contentIndex: 1, contentType: "tool-call",
        toolCallId: createToolCallId("nameless") },
      { type: "finished", reason },
    ];
    await expect(collectStream(asStream(events))).resolves.toEqual({
      content: [{ type: "text", text: "prefix" }], finishReason: reason,
    });
  });

  it("collects completed content, usage, and the terminal reason", async () => {
    const events: ModelEvent[] = [
      { type: "content-started", contentIndex: 0, contentType: "text" },
      { type: "content-delta", contentIndex: 0, contentType: "text", delta: "done" },
      { type: "content-completed", contentIndex: 0, contentType: "text" },
      { type: "usage", usage: { inputTokens: 4, outputTokens: 2 } },
      { type: "finished", reason: { kind: "stop" } },
    ];

    await expect(collectStream(asStream(events))).resolves.toEqual({
      content: [{ type: "text", text: "done" }],
      usage: { inputTokens: 4, outputTokens: 2 },
      finishReason: { kind: "stop" },
    });
  });

  it("leaves an incomplete stream without a finish reason", async () => {
    await expect(collectStream(asStream([]))).resolves.toEqual({ content: [] });
  });

  it("assembles interleaved text, reasoning, and tool calls by content index", async () => {
    const callId = createToolCallId("weather");
    const events: ModelEvent[] = [
      { type: "content-started", contentIndex: 0, contentType: "text" },
      { type: "content-started", contentIndex: 1, contentType: "reasoning" },
      { type: "content-started", contentIndex: 2, contentType: "tool-call", toolCallId: callId },
      { type: "content-delta", contentIndex: 0, contentType: "text", delta: "Checking " },
      { type: "content-delta", contentIndex: 1, contentType: "reasoning", delta: "Need weather." },
      { type: "content-delta", contentIndex: 0, contentType: "text", delta: "now." },
      {
        type: "content-delta",
        contentIndex: 2,
        contentType: "tool-call",
        toolCallId: callId,
        toolNameDelta: "weather",
        delta: "{\"city\"",
      },
      {
        type: "content-delta",
        contentIndex: 2,
        contentType: "tool-call",
        toolCallId: callId,
        delta: ":\"Shanghai\"}",
      },
      { type: "content-completed", contentIndex: 0, contentType: "text" },
      { type: "content-completed", contentIndex: 1, contentType: "reasoning" },
      { type: "content-completed", contentIndex: 2, contentType: "tool-call" },
      { type: "finished", reason: { kind: "tool-calls" } },
    ];

    await expect(collectStream(asStream(events))).resolves.toEqual({
      content: [
        { type: "text", text: "Checking now." },
        { type: "reasoning", text: "Need weather." },
        {
          type: "tool-call",
          id: callId,
          name: "weather",
          arguments: "{\"city\":\"Shanghai\"}",
        },
      ],
      finishReason: { kind: "tool-calls" },
    });
  });

  it("rejects content data emitted outside its lifecycle", async () => {
    const events: ModelEvent[] = [
      { type: "content-delta", contentIndex: 0, contentType: "text", delta: "orphan" },
      { type: "finished", reason: { kind: "stop" } },
    ];

    await expect(collectStream(asStream(events))).rejects.toThrow("before it started");
  });

  it("drops an open tool call when max-tokens interrupts its arguments", async () => {
    const events: ModelEvent[] = [
      { type: "content-started", contentIndex: 0, contentType: "text" },
      { type: "content-delta", contentIndex: 0, contentType: "text", delta: "partial" },
      {
        type: "content-started",
        contentIndex: 1,
        contentType: "tool-call",
        toolCallId: createToolCallId("partial-call"),
      },
      { type: "content-delta", contentIndex: 1, contentType: "tool-call",
        toolCallId: createToolCallId("partial-call"), toolNameDelta: "weather",
        delta: "{\"city\":" },
      { type: "finished", reason: { kind: "max-tokens" } },
    ];

    await expect(collectStream(asStream(events))).resolves.toEqual({
      content: [{ type: "text", text: "partial" }],
      finishReason: { kind: "max-tokens" },
    });
  });

  it("removes tool calls from a content-filtered response", async () => {
    const callId = createToolCallId("filtered-call");
    const events: ModelEvent[] = [
      { type: "content-started", contentIndex: 0, contentType: "text" },
      { type: "content-delta", contentIndex: 0, contentType: "text", delta: "safe prefix" },
      { type: "content-completed", contentIndex: 0, contentType: "text" },
      { type: "content-started", contentIndex: 1, contentType: "tool-call", toolCallId: callId },
      { type: "content-delta", contentIndex: 1, contentType: "tool-call",
        toolCallId: callId, toolNameDelta: "dangerous", delta: "{}" },
      { type: "content-completed", contentIndex: 1, contentType: "tool-call" },
      { type: "finished", reason: { kind: "content-filter" } },
    ];

    await expect(collectStream(asStream(events))).resolves.toEqual({
      content: [{ type: "text", text: "safe prefix" }],
      finishReason: { kind: "content-filter" },
    });
  });
});

async function* asStream(
  events: readonly ModelEvent[],
): AsyncGenerator<ModelEvent> {
  yield* events;
}
