import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { agentTurnMethod, StreamRpcRouter, StreamRpcServer } from "../rpc/index.js";
import { createAgentTurnHandler } from "../src/host/agent-turn-handler.js";
import { resolveKernelHostConfig } from "../src/host/config.js";
import {
  createMockAgentTurnHandler,
  resolveMockAgentTurnConfig,
} from "../src/host/mock-agent-turn.js";
import { StdioRpcServerTransport } from "../src/host/stdio-transport.js";
import { createRuntime, disposeRuntimes } from "./helpers/runtime.js";

afterEach(disposeRuntimes);

describe("Kernel Host agent.turn", () => {
  it("emits started, visible deltas and one completed terminal while hiding reasoning", async () => {
    const kit = await createRuntime([{
      kind: "chunks",
      chunks: [
        { type: "reasoning-delta", index: 0, text: "private" },
        { type: "text-delta", index: 1, text: "hello " },
        { type: "text-delta", index: 1, text: "world" },
        { type: "block-end", index: 0, block: { type: "reasoning", text: "private" } },
        { type: "block-end", index: 1, block: { type: "text", text: "hello world" } },
        { type: "finish", reason: { kind: "stop" } },
      ],
    }]);
    const handler = createAgentTurnHandler(kit.ctx, {
      model: { provider: "mock", model: "test" },
    });

    const events = await collect(handler({
      sessionId: "desktop-session",
      requestId: "desktop-request",
      text: "hello",
    }, new AbortController().signal));

    expect(events.map((event) => event.type)).toEqual([
      "started", "text-delta", "text-delta", "completed",
    ]);
    expect(events.filter((event) => event.type === "text-delta")
      .map((event) => event.text).join(""))
      .toBe("hello world");
    expect(kit.adapter.requests[0]?.tools).toEqual([]);
  });

  it("retains a published prefix and terminates as cancelled", async () => {
    const kit = await createRuntime([{
      kind: "hang",
      chunksBeforeHang: [{ type: "text-delta", index: 0, text: "partial" }],
    }]);
    const controller = new AbortController();
    const handler = createAgentTurnHandler(kit.ctx, {
      model: { provider: "mock", model: "test" },
    });
    const iterator = handler({
      sessionId: "cancel-session",
      requestId: "cancel-request",
      text: "stop",
    }, controller.signal)[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "started" } });
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: "text-delta", text: "partial" },
    });
    controller.abort("user stop");
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: { type: "cancelled" },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("turns an incomplete visible model stream into one failed terminal without retry", async () => {
    const kit = await createRuntime([
      {
        kind: "chunks",
        chunks: [{ type: "text-delta", index: 0, text: "partial" }],
      },
      {
        kind: "chunks",
        chunks: [{ type: "finish", reason: { kind: "stop" } }],
      },
    ]);
    const handler = createAgentTurnHandler(kit.ctx, {
      model: { provider: "mock", model: "test" },
    });

    const events = await collect(handler({
      sessionId: "broken-session",
      requestId: "broken-request",
      text: "break",
    }, new AbortController().signal));

    expect(events.map((event) => event.type)).toEqual([
      "started", "text-delta", "failed",
    ]);
    expect(events.at(-1)).toMatchObject({
      failure: { code: "stream-incomplete" },
    });
    expect(kit.adapter.remainingEntries).toBe(1);
  });

  it("does not retry a provider error after visible output was published", async () => {
    const kit = await createRuntime([
      {
        kind: "error",
        chunksBeforeError: [{ type: "text-delta", index: 0, text: "visible" }],
        error: new Error("socket failed"),
      },
      {
        kind: "chunks",
        chunks: [{ type: "finish", reason: { kind: "stop" } }],
      },
    ]);
    const handler = createAgentTurnHandler(kit.ctx, {
      model: { provider: "mock", model: "test" },
    });

    const events = await collect(handler({
      sessionId: "retry-session",
      requestId: "retry-request",
      text: "retry",
    }, new AbortController().signal));

    expect(events.at(-1)).toMatchObject({
      type: "failed",
      failure: { code: "stream-output-interrupted" },
    });
    expect(kit.adapter.remainingEntries).toBe(1);
  });

  it("splits oversized provider deltas at the public RPC output limit", async () => {
    const text = `${"a".repeat(16_383)}😀tail`;
    const kit = await createRuntime([{
      kind: "chunks",
      chunks: [
        { type: "text-delta", index: 0, text },
        { type: "block-end", index: 0, block: { type: "text", text } },
        { type: "finish", reason: { kind: "stop" } },
      ],
    }]);
    const handler = createAgentTurnHandler(kit.ctx, {
      model: { provider: "mock", model: "test" },
    });

    const events = await collect(handler({
      sessionId: "large-session",
      requestId: "large-request",
      text: "large",
    }, new AbortController().signal));
    const deltas = events.filter((event) => event.type === "text-delta");
    expect(deltas.every((event) => event.text.length <= 16_384)).toBe(true);
    expect(deltas.map((event) => event.text).join("")).toBe(text);
  });
});

describe("stdio RPC transport and scripted Mock Host", () => {
  it("carries valid NDJSON frames and closes after stdin EOF", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.setEncoding("utf8");
    let stdout = "";
    const ended = Promise.withResolvers<void>();
    output.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.includes('"type":"end"')) ended.resolve();
    });
    const transport = new StdioRpcServerTransport(input, output);
    const router = new StreamRpcRouter();
    router.register(agentTurnMethod, createMockAgentTurnHandler({
      mode: "completed",
      text: "OK {{input}}",
      chunkChars: 3,
      delayMs: 0,
    }));
    const server = new StreamRpcServer(transport, router);
    const serving = server.serve();
    input.write(`${JSON.stringify({
      version: 1,
      type: "open",
      id: "rpc-1",
      method: "agent.turn",
      params: { sessionId: "s", requestId: "r", text: "go" },
    })}\n`);
    await ended.promise;
    input.end();
    await serving;
    await transport.close();

    const frames = stdout.trim().split("\n").map((line) => JSON.parse(line));
    expect(frames.map((frame) => frame.type)).toEqual([
      "item", "item", "item", "item", "end",
    ]);
    expect(frames.map((frame) => frame.value?.type).filter(Boolean)).toEqual([
      "started", "text-delta", "text-delta", "completed",
    ]);
  });

  it("supports deterministic failure, hang and environment validation", async () => {
    const failed = createMockAgentTurnHandler({
      mode: "failed", text: "", chunkChars: 1, delayMs: 0,
    });
    expect(await collect(failed(
      { sessionId: "s", requestId: "r", text: "x" },
      new AbortController().signal,
    ))).toMatchObject([
      { type: "started" },
      { type: "failed", failure: { code: "mock-failure" } },
    ]);
    expect(() => resolveMockAgentTurnConfig({ SKILLWORLD_MOCK_MODE: "wrong" }))
      .toThrow("invalid");
  });
});

describe("Kernel Host trusted configuration", () => {
  it("defaults to visible-answer mode with a bounded output budget", () => {
    const config = resolveKernelHostConfig({});

    expect(config.adapter.enableThinking).toBe(false);
    expect(config.agent.model.maxTokens).toBe(8_192);
  });

  it("validates explicit thinking and output-budget overrides", () => {
    expect(resolveKernelHostConfig({
      LLM_ENABLE_THINKING: "true",
      LLM_MAX_TOKENS: "4096",
    })).toMatchObject({
      adapter: { enableThinking: true },
      agent: { model: { maxTokens: 4_096 } },
    });
    expect(() => resolveKernelHostConfig({ LLM_ENABLE_THINKING: "yes" }))
      .toThrow("LLM_ENABLE_THINKING");
    expect(() => resolveKernelHostConfig({ LLM_MAX_TOKENS: "65537" }))
      .toThrow("LLM_MAX_TOKENS");
  });
});

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}
