import { Context } from "cordis";

import type { GenerateRequest, StreamChunk } from "../../src/llm/types.js";
import { LLMService } from "../../src/llm/service.js";

export const textStream: readonly StreamChunk[] = [
  { type: "block-start", index: 0, blockType: "text" },
  { type: "text-delta", index: 0, text: "hello" },
  {
    type: "block-end",
    index: 0,
    block: { type: "text", text: "hello" },
  },
  { type: "usage", usage: { inputTokens: 3, outputTokens: 1 } },
  { type: "finish", reason: { kind: "stop" } },
];

export function request(
  provider: string,
  signal?: AbortSignal,
): GenerateRequest {
  return {
    provider,
    model: "test-model",
    messages: [],
    ...(signal === undefined ? {} : { signal }),
  };
}

export async function collect(
  stream: AsyncIterable<StreamChunk>,
): Promise<StreamChunk[]> {
  const chunks: StreamChunk[] = [];
  for await (const chunk of stream) chunks.push(chunk);
  return chunks;
}

export interface LLMTestKit {
  readonly createContext: () => Promise<Context>;
  readonly track: (ctx: Context) => void;
  readonly dispose: () => Promise<void>;
}

export function createLLMTestKit(): LLMTestKit {
  const contexts = new Set<Context>();
  return {
    async createContext(): Promise<Context> {
      const ctx = new Context();
      contexts.add(ctx);
      await ctx.plugin(LLMService);
      return ctx;
    },
    track(ctx: Context): void {
      contexts.add(ctx);
    },
    async dispose(): Promise<void> {
      await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
      contexts.clear();
    },
  };
}
