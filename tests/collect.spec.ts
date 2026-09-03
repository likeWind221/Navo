import { describe, expect, it } from "vitest";

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
});

async function* asStream(
  chunks: readonly StreamChunk[],
): AsyncGenerator<StreamChunk> {
  yield* chunks;
}
