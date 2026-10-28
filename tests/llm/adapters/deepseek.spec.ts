import { expect, it } from "vitest";
import { DeepSeekAdapter } from "../../../src/llm/adapters/deepseek.js";
import { createMessageId } from "../../../src/brand/ids.js";
import type { GenerateRequest, ModelEvent } from "../../../src/llm/types.js";
import { resolveKernelHostConfig } from "../../../src/host/config.js";

const request: GenerateRequest = { provider: "deepseek", model: "deepseek-flash",
  messages: [{ id: createMessageId("test"), role: "user", content: [{ type: "text", text: "lookup" }] }] };
async function collect(stream: AsyncIterable<ModelEvent>) {
  const result: ModelEvent[] = [];
  for await (const event of stream) result.push(event);
  return result;
}
function response(delta: object, finish = "stop") {
  return new Response(`data: ${JSON.stringify({ choices: [{ delta, finish_reason: finish }],
    usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } })}\n\ndata: [DONE]\n\n`);
}

it("accepts null intermediate usage and emits the final usage", async () => {
  const adapter = new DeepSeekAdapter({ baseUrl: "https://api.deepseek.com", fetch: async () => new Response(
    'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":null}],"usage":null}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}],"usage":{"prompt_tokens":3,"completion_tokens":2}}\n\n' +
    'data: [DONE]\n\n') });
  const events = await collect(adapter.stream(request));
  expect(events).toContainEqual(expect.objectContaining({ type: "content-delta", contentType: "text", delta: "hello" }));
  expect(events).toContainEqual({ type: "usage", usage: { inputTokens: 3, outputTokens: 2 } });
  expect(events).toContainEqual({ type: "finished", reason: { kind: "stop" } });
});

it("leaves usage unknown if no usage object arrives", async () => {
  const adapter = new DeepSeekAdapter({ baseUrl: "https://api.deepseek.com", fetch: async () => new Response(
    'data: {"choices":[{"delta":{"content":"hello"},"finish_reason":"stop"}],"usage":null}\n\n' +
    'data: [DONE]\n\n') });
  const events = await collect(adapter.stream(request));
  expect(events.some(event => event.type === "usage")).toBe(false);
  expect(events).toContainEqual({ type: "finished", reason: { kind: "stop" } });
});

it("preserves DeepSeek reasoning, tool IDs and arguments through a second request", async () => {
  const bodies: Record<string, any>[] = [];
  const adapter = new DeepSeekAdapter({ baseUrl: "https://api.deepseek.com", apiKey: "key",
    fetch: async (url, init) => {
      expect(String(url)).toBe("https://api.deepseek.com/chat/completions");
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer key");
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1 ? response({ reasoning_content: "look up evidence",
        tool_calls: [{ index: 0, id: "call_1", type: "function",
          function: { name: "lookup", arguments: '{"id":"a"}' } }] }, "tool_calls")
        : response({ content: "done" });
    } });
  const tools = [{ name: "lookup", description: "lookup", parameters: { type: "object" as const,
    properties: { id: { type: "string" as const } }, required: ["id"] } }];
  const events = await collect(adapter.stream({ ...request, tools }));
  expect(events).toContainEqual(expect.objectContaining({ type: "content-delta", contentType: "reasoning", delta: "look up evidence" }));
  expect(events).toContainEqual(expect.objectContaining({ type: "usage", usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 } }));
  await collect(adapter.stream({ ...request, tools, messages: [...request.messages,
    { id: createMessageId("test"), role: "assistant", content: [
      { type: "reasoning", text: "look up evidence" },
      { type: "tool-call", id: "call_1" as any, name: "lookup", arguments: '{"id":"a"}' }] },
    { id: createMessageId("test"), role: "user", content: [{ type: "tool-result", isError: false, toolCallId: "call_1" as any,
      content: [{ type: "text", text: "evidence" }] }] }] }));
  expect(bodies[0]).toMatchObject({ thinking: { type: "enabled" }, reasoning_effort: "high" });
  expect(bodies[0]).not.toHaveProperty("chat_template_kwargs");
  expect(bodies[1]!.messages[1]).toMatchObject({ reasoning_content: "look up evidence",
    tool_calls: [{ id: "call_1", function: { name: "lookup", arguments: '{"id":"a"}' } }] });
  expect(bodies[1]!.messages[2]).toMatchObject({ role: "tool", tool_call_id: "call_1", content: "evidence" });
});

it("disables thinking explicitly and forwards cancellation", async () => {
  const controller = new AbortController();
  const adapter = new DeepSeekAdapter({ baseUrl: "https://api.deepseek.com", enableThinking: false,
    fetch: async (_, init) => {
      expect(JSON.parse(String(init?.body))).toMatchObject({ thinking: { type: "disabled" } });
      expect(init?.signal).toBe(controller.signal);
      controller.abort(new Error("stop"));
      throw controller.signal.reason;
    } });
  await expect(collect(adapter.stream({ ...request, signal: controller.signal }))).rejects.toThrow("stop");
});

it.each([[401, "AUTH"], [429, "RATE_LIMIT"], [500, "SERVER"], [400, "INVALID_REQUEST"]])(
  "maps HTTP %i without exposing response secrets", async (status, code) => {
    const adapter = new DeepSeekAdapter({ baseUrl: "https://api.deepseek.com",
      fetch: async () => new Response("secret-body", { status: Number(status) }) });
    await expect(collect(adapter.stream(request))).rejects.toMatchObject({ code, status });
    await expect(collect(adapter.stream(request))).rejects.not.toThrow("secret-body");
  });

it("requires a key and isolates graph credentials for different endpoints", () => {
  expect(() => resolveKernelHostConfig({ LLM_PROVIDER: "deepseek" })).toThrow("API_KEY");
  const config = resolveKernelHostConfig({ LLM_PROVIDER: "deepseek", DEEPSEEK_API_KEY: "main",
    GRAPH_PROVIDER: "deepseek", GRAPH_MODEL: "deepseek-flash", GRAPH_API_KEY: "graph",
    GRAPH_BASE_URL: "https://graph.test" });
  expect(config.graph).toMatchObject({ compatibilityProvider: "deepseek", adapter: { apiKey: "graph" } });
  expect(config.agent.model).toMatchObject({ provider: "deepseek", model: "deepseek-flash" });
  expect(() => resolveKernelHostConfig({ LLM_PROVIDER: "deepseek", LLM_API_KEY: "main",
    GRAPH_PROVIDER: "deepseek", GRAPH_MODEL: "deepseek-flash", GRAPH_BASE_URL: "https://graph.test" })).toThrow("API key");
});
