import { Context } from "cordis";

import { createMessageId, createSessionId } from "../../src/brand/ids.js";
import { AgentRuntime } from "../../src/agent/runtime.js";
import type { RunTurnInput } from "../../src/agent/types.js";
import { MockLLMAdapter } from "../../src/llm/mock.js";
import type { StreamContentBlock } from "../../src/llm/types.js";
import { LLMService } from "../../src/llm/service.js";
import { SessionStore } from "../../src/session/store.js";
import { ToolService } from "../../src/tools/service.js";
import { TestTools } from "../../src/tools/testing.js";

const contexts = new Set<Context>();

export interface RuntimeTestkit {
  readonly ctx: Context;
  readonly adapter: MockLLMAdapter;
}

export async function createRuntime(
  entries: ConstructorParameters<typeof MockLLMAdapter>[0],
): Promise<RuntimeTestkit> {
  const ctx = new Context();
  contexts.add(ctx);
  await ctx.plugin(SessionStore);
  await ctx.plugin(LLMService);
  await ctx.plugin(ToolService);
  await ctx.plugin(TestTools);
  await ctx.plugin(AgentRuntime);
  const adapter = new MockLLMAdapter(entries);
  ctx.llm.registerAdapter("mock", adapter);
  return { ctx, adapter };
}

export async function disposeRuntimes(): Promise<void> {
  await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
  contexts.clear();
}

export function turnInput(suffix: string): RunTurnInput {
  return {
    sessionId: createSessionId(`session-${suffix}`),
    userMessage: {
      id: createMessageId(`message-${suffix}`),
      role: "user",
      content: [{ type: "text", text: suffix }],
    },
    model: { provider: "mock", model: "test" },
  };
}

export function modelResponse(
  blocks: readonly StreamContentBlock[],
  finish: "stop" | "tool-calls" | "content-filter" | "max-tokens" = "stop",
) {
  return {
    kind: "chunks" as const,
    chunks: [
      ...blocks.map((block, index) => ({
        type: "block-end" as const,
        index,
        block,
      })),
      { type: "finish" as const, reason: { kind: finish } },
    ],
  };
}

export function modelError(code: string) {
  return {
    kind: "chunks" as const,
    chunks: [{
      type: "finish" as const,
      reason: { kind: "error" as const, failure: { code, message: code } },
    }],
  };
}

export function eventTypes(kit: RuntimeTestkit, suffix: string): string[] {
  return kit.ctx.sessions.getEvents(turnInput(suffix).sessionId)
    .map((event) => event.type);
}

export function assertClosed(kit: RuntimeTestkit, suffix: string): void {
  const types = eventTypes(kit, suffix);
  expectCount(types, "turn-started", 1);
  expectCount(types, "turn-ended", 1);
  expectCount(
    types,
    "step-ended",
    types.filter((type) => type === "step-started").length,
  );
}

function expectCount(types: string[], type: string, expected: number): void {
  const actual = types.filter((candidate) => candidate === type).length;
  if (actual !== expected) {
    throw new Error(`Expected ${expected} '${type}' events but received ${actual}.`);
  }
}
