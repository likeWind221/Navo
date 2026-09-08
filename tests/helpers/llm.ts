import { Context } from "cordis";

import type { GenerateRequest, ModelEvent } from "../../src/llm/types.js";
import { LLMService } from "../../src/llm/service.js";

export const textEvents: readonly ModelEvent[] = [
  { type: "content-started", contentIndex: 0, contentType: "text" },
  { type: "content-delta", contentIndex: 0, contentType: "text", delta: "hello" },
  { type: "content-completed", contentIndex: 0, contentType: "text" },
  { type: "usage", usage: { inputTokens: 3, outputTokens: 1 } },
  { type: "finished", reason: { kind: "stop" } },
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
  stream: AsyncIterable<ModelEvent>,
): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
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
