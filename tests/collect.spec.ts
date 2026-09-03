import { describe, expect, it } from "vitest";

import { createToolCallId } from "../src/brand/ids.js";
import { collectStream } from "../src/llm/collect.js";
import type { StreamChunk } from "../src/llm/types.js";

describe("collectStream", () => {
  it("collects completed blocks, usage, and the terminal reason", async () => {
    const chunks: StreamChunk[] = [
      { type: "text-delta", index: 0, text: "ignored delta" },
      { type: "block-end", index: 0, block: { type: "text", text: "done" } },
      { type: "usage", usage: { inputTokens: 4, outputTokens: 2 } },
      { type: "finish", reason: { kind: "stop" } },
    ];

    await expect(collectStream(asStream(chunks))).resolves.toEqual({
      content: [{ type: "text", text: "done" }],
      usage: { inputTokens: 4, outputTokens: 2 },
      finishReason: { kind: "stop" },
    });
  });

  it("leaves an incomplete stream without a finish reason", async () => {
    await expect(collectStream(asStream([]))).resolves.toEqual({ content: [] });
  });

  it("assembles delta-only text, reasoning, and tool calls by block index", async () => {
    const callId = createToolCallId("weather");
    const chunks: StreamChunk[] = [
      { type: "text-delta", index: 0, text: "Checking " },
      { type: "reasoning-delta", index: 1, text: "Need weather." },
      { type: "text-delta", index: 0, text: "now." },
      {
        type: "tool-call-delta",
        index: 2,
        id: callId,
        name: "weather",
        argumentsDelta: "{\"city\"",
      },
      {
        type: "tool-call-delta",
        index: 2,
        id: callId,
        argumentsDelta: ":\"Shanghai\"}",
      },
      { type: "finish", reason: { kind: "tool-calls" } },
    ];

    await expect(collectStream(asStream(chunks))).resolves.toEqual({
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

  it("uses block-end as the authoritative completed value", async () => {
    const chunks: StreamChunk[] = [
      { type: "text-delta", index: 0, text: "draft" },
      { type: "block-end", index: 0, block: { type: "text", text: "final" } },
      { type: "text-delta", index: 0, text: " ignored" },
      { type: "finish", reason: { kind: "stop" } },
    ];

    await expect(collectStream(asStream(chunks))).resolves.toEqual({
      content: [{ type: "text", text: "final" }],
      finishReason: { kind: "stop" },
    });
  });

  it("drops an open tool call when max-tokens interrupts its arguments", async () => {
    const chunks: StreamChunk[] = [
      { type: "text-delta", index: 0, text: "partial" },
      {
        type: "tool-call-delta",
        index: 1,
        id: createToolCallId("partial-call"),
        name: "weather",
        argumentsDelta: "{\"city\":",
      },
      { type: "finish", reason: { kind: "max-tokens" } },
    ];

    await expect(collectStream(asStream(chunks))).resolves.toEqual({
      content: [{ type: "text", text: "partial" }],
      finishReason: { kind: "max-tokens" },
    });
  });

  it("removes tool calls from a content-filtered response", async () => {
    const chunks: StreamChunk[] = [
      { type: "block-end", index: 0, block: { type: "text", text: "safe prefix" } },
      {
        type: "block-end",
        index: 1,
        block: {
          type: "tool-call",
          id: createToolCallId("filtered-call"),
          name: "dangerous",
          arguments: "{}",
        },
      },
      { type: "finish", reason: { kind: "content-filter" } },
    ];

    await expect(collectStream(asStream(chunks))).resolves.toEqual({
      content: [{ type: "text", text: "safe prefix" }],
      finishReason: { kind: "content-filter" },
    });
  });
});

async function* asStream(
  chunks: readonly StreamChunk[],
): AsyncGenerator<StreamChunk> {
  yield* chunks;
}
