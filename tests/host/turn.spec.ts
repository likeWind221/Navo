import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it } from "vitest";

import { agentTurnMethod, StreamRpcRouter, StreamRpcServer } from "../../rpc/index.js";
import { createAgentTurnHandler } from "../../src/host/turn.js";
import { resolveKernelHostConfig } from "../../src/host/config.js";
import {
  createMockAgentTurnHandler,
  resolveMockAgentTurnConfig,
} from "../../src/host/turn/mock.js";
import { StdioRpcServerTransport } from "../../src/host/stdio.js";
import { createRuntime, disposeRuntimes } from "../helpers/runtime.js";

afterEach(disposeRuntimes);

describe("Kernel Host agent.turn", () => {
  it("emits started, visible deltas and one completed terminal while hiding reasoning", async () => {
    const kit = await createRuntime([{
      kind: "events",
      events: [
        { type: "content-started", contentIndex: 0, contentType: "reasoning" },
        { type: "content-delta", contentIndex: 0, contentType: "reasoning", delta: "private" },
        { type: "content-completed", contentIndex: 0, contentType: "reasoning" },
        { type: "content-started", contentIndex: 1, contentType: "text" },
        { type: "content-delta", contentIndex: 1, contentType: "text", delta: "hello " },
        { type: "content-delta", contentIndex: 1, contentType: "text", delta: "world" },
        { type: "content-completed", contentIndex: 1, contentType: "text" },
        { type: "finished", reason: { kind: "stop" } },
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
      eventsBeforeHang: [
        { type: "content-started", contentIndex: 0, contentType: "text" },
        { type: "content-delta", contentIndex: 0, contentType: "text", delta: "partial" },
      ],
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

  it("splits oversized provider deltas at the public RPC output limit", async () => {
    const text = `${"a".repeat(16_383)}😀tail`;
    const kit = await createRuntime([{
      kind: "events",
      events: [
        { type: "content-started", contentIndex: 0, contentType: "text" },
        { type: "content-delta", contentIndex: 0, contentType: "text", delta: text },
        { type: "content-completed", contentIndex: 0, contentType: "text" },
        { type: "finished", reason: { kind: "stop" } },
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
      if (stdout.includes('\"type\":\"end\"')) ended.resolve();
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

  it("reports one invalid stdin frame and continues serving later frames", async () => {
    const input = new PassThrough();
    const output = new PassThrough();
    output.setEncoding("utf8");
    let stdout = "";
    const diagnostics: string[] = [];
    const ended = Promise.withResolvers<void>();
    output.on("data", (chunk: string) => {
      stdout += chunk;
      if (stdout.includes('\"type\":\"end\"')) ended.resolve();
    });
    const transport = new StdioRpcServerTransport(
      input,
      output,
      (error) => diagnostics.push(error.message),
    );
    const router = new StreamRpcRouter();
    router.register(agentTurnMethod, createMockAgentTurnHandler({
      mode: "completed",
      text: "OK",
      chunkChars: 2,
      delayMs: 0,
    }));
    const server = new StreamRpcServer(transport, router);
    const serving = server.serve();
    input.write("not-json\n");
    input.write(`${JSON.stringify({ version: 1, type: "unknown" })}\n`);
    input.write(`${JSON.stringify({
      version: 1,
      type: "open",
      id: "rpc-after-invalid",
      method: "agent.turn",
      params: { sessionId: "s", requestId: "r", text: "go" },
    })}\n`);
    await ended.promise;
    input.end();
    await serving;
    await transport.close();

    expect(diagnostics).toEqual([
      "NDJSON frame is not valid JSON",
      "Unknown or malformed RPC client frame",
    ]);
    expect(stdout.trim().split("\n").map((line) => JSON.parse(line).type))
      .toEqual(["item", "item", "item", "end"]);
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
    expect(() => resolveMockAgentTurnConfig({ NAVO_MOCK_MODE: "wrong" }))
      .toThrow("invalid");
  });
});

describe("Kernel Host trusted configuration", () => {
  it("defaults to thinking mode with a bounded output budget", () => {
    const config = resolveKernelHostConfig({});

    expect(config.adapter.enableThinking).toBe(true);
    expect(config.agent.model.maxTokens).toBe(8_192);
    expect(config.agent.toolNames).toBeUndefined();
    expect(config.search).toBeUndefined();
  });

  it("enables web search only when a trusted Exa key is configured", () => {
    const config = resolveKernelHostConfig({ EXA_API_KEY: "exa-secret" });

    expect(config.search).toEqual({ apiKey: "exa-secret" });
    expect(config.agent.toolNames).toEqual(["web_search"]);
    expect(Object.isFrozen(config.agent.toolNames)).toBe(true);
  });

  it("validates explicit thinking and output-budget overrides", () => {
    expect(resolveKernelHostConfig({ LLM_ENABLE_THINKING: "false" }).adapter.enableThinking).toBe(false);
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
    expect(() => resolveKernelHostConfig({ EXA_API_KEY: "not printable\n" }))
      .toThrow("EXA_API_KEY");
  });
});

async function collect<T>(stream: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of stream) values.push(value);
  return values;
}
