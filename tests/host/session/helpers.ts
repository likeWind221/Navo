import type { Context } from "cordis";
import { afterEach, expect } from "vitest";

import {
  RpcError,
  StreamRpcClient,
  StreamRpcRouter,
  StreamRpcServer,
} from "../../../rpc/index.js";
import type { RpcMethod } from "../../../rpc/index.js";
import { createTransportPair } from "../../../rpc/tests/helpers/transport.js";
import { createApp } from "../../../src/app.js";
import type { TurnModelConfig } from "../../../src/agent/types.js";
import { createGenerateRequest } from "../../../src/agent/request.js";
import { createMessageId, createSessionId, createStepId, createTurnId } from "../../../src/brand/ids.js";
import type { SessionId } from "../../../src/brand/ids.js";
import { resolveContextBudget } from "../../../src/context/budget.js";
import { compactSession } from "../../../src/context/compaction/compact.js";
import { registerSessionMethods } from "../../../src/host/session.js";
import type { MockLLMEntry } from "../../../src/llm/adapters/mock.js";
import { MockLLMAdapter } from "../../../src/llm/adapters/mock.js";
import type { StorageConfig } from "../../../src/storage/database.js";
import { MEMORY_STORAGE } from "../../helpers/storage.js";

const cleanups: Array<() => Promise<void>> = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

export const DEFAULT_MODEL: TurnModelConfig = Object.freeze({
  provider: "mock",
  model: "mock",
  contextWindow: 20_000,
  maxTokens: 500,
  autoCompactLimit: 10_000,
});

export interface HostOptions {
  readonly model?: TurnModelConfig;
  readonly agent?: boolean;
  readonly storage?: StorageConfig;
}

export async function host(
  entries: readonly MockLLMEntry[] = [],
  options: HostOptions = {},
) {
  const model = options.model ?? DEFAULT_MODEL;
  const ctx = await createApp({
    storage: options.storage ?? MEMORY_STORAGE,
    node: { session: { model } },
    ...(options.agent === false ? {} : { agent: { model, systemPrompt: "", toolNames: [] } }),
  });
  const adapter = new MockLLMAdapter(entries);
  ctx.llm.registerAdapter("mock", adapter);
  const pair = createTransportPair();
  const router = new StreamRpcRouter();
  registerSessionMethods(router, ctx);
  const server = new StreamRpcServer(pair.server, router);
  const serving = server.serve();
  const client = new StreamRpcClient(pair.client);
  cleanups.push(async () => {
    pair.close();
    await server.dispose();
    await serving;
    await ctx.fiber.dispose();
  });
  return { ctx, client, adapter };
}

export async function call<I, O>(
  client: StreamRpcClient,
  method: RpcMethod<I, O>,
  input: I,
): Promise<O> {
  const items: O[] = [];
  for await (const item of client.stream(method, input)) items.push(item);
  expect(items).toHaveLength(1);
  return items[0]!;
}

export async function failureOf<I, O>(
  client: StreamRpcClient,
  method: RpcMethod<I, O>,
  input: I,
) {
  const error = await call(client, method, input).then(() => undefined, (cause: unknown) => cause);
  expect(error).toBeInstanceOf(RpcError);
  return (error as RpcError).failure;
}

export function appendUser(ctx: Context, sessionId: SessionId, id: string, text: string): number {
  return ctx.sessions.append({
    type: "user-message",
    sessionId,
    data: {
      message: {
        id: createMessageId(id),
        role: "user",
        content: [{ type: "text", text }],
      },
    },
  }).sequence;
}

export function appendAssistant(
  ctx: Context,
  sessionId: SessionId,
  id: string,
  text: string,
): number {
  return ctx.sessions.append({
    type: "assistant-message",
    sessionId,
    data: {
      turnId: createTurnId(`turn-${id}`),
      stepId: createStepId(`step-${id}`),
      message: {
        id: createMessageId(id),
        role: "assistant",
        content: [{ type: "text", text }],
      },
      finishReason: { kind: "stop" },
    },
  }).sequence;
}

export function seedConversation(
  ctx: Context,
  sessionId: SessionId,
  count: number,
  characters: number,
): void {
  for (let index = 0; index < count; index += 1) {
    appendUser(ctx, sessionId, `seed-user-${index}`, "u".repeat(characters));
    if (index < count - 1) {
      appendAssistant(ctx, sessionId, `seed-assistant-${index}`, "a".repeat(characters));
    }
  }
}

export async function compact(ctx: Context, sessionId: SessionId): Promise<void> {
  const context = ctx.sessionContexts.resolve(sessionId);
  const budget = resolveContextBudget(context.model);
  expect(budget.kind).toBe("enabled");
  if (budget.kind !== "enabled") return;
  const signal = new AbortController().signal;
  const request = createGenerateRequest(ctx, {
    sessionId,
    model: context.model,
    systemPrompt: context.systemPrompt,
    toolNames: context.toolNames,
  }, signal);
  const outcome = await compactSession(ctx, {
    sessionId,
    model: context.model,
    request,
    thresholdTokens: budget.thresholdTokens,
    retainTokens: budget.retainTokens,
    trigger: "manual",
    signal,
    cancelSignal: signal,
    maxRetries: 2,
  });
  expect(outcome.kind).toBe("compacted");
}

export function session(id: string): SessionId {
  return createSessionId(id);
}

export function delay(milliseconds = 0): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}
