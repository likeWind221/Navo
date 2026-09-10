import { describe, expect, it } from "vitest";

import { createMessageId } from "../../../src/brand/ids.js";
import { LLMProviderError } from "../../../src/llm/errors.js";
import { QwenChatCompletionsAdapter } from "../../../src/llm/adapters/qwen.js";
import { QWEN_SSE_MAX_EVENT_CHARS } from "../../../src/llm/adapters/qwen/sse.js";
import type { GenerateRequest, ModelEvent } from "../../../src/llm/types.js";

describe("QwenChatCompletionsAdapter", () => {
  it("streams reasoning and visible text separately and serializes a safe request", async () => {
    let sentUrl = "";
    let sentInit: RequestInit | undefined;
    const adapter = new QwenChatCompletionsAdapter({
      baseUrl: "http://model.test/v1/",
      apiKey: "secret-token",
      fetch: async (input, init) => {
        sentUrl = String(input);
        sentInit = init;
        return sseResponse([
          "data: {\"choices\":[{\"delta\":{\"reasoning\":\"think\"},\"finish_reason\":null}]}\n\n",
          "data: {\"choices\":[{\"delta\":{\"content\":\"你\"},\"finish_reason\":null}]}\n",
          "\ndata: {\"choices\":[{\"delta\":{\"content\":\"好\"},\"finish_reason\":\"stop\"}],\"usage\":{\"prompt_tokens\":3,\"completion_tokens\":2,\"total_tokens\":5,\"completion_tokens_details\":{\"reasoning_tokens\":1}}}\n\n",
          "data: [DONE]\n\n",
        ]);
      },
    });

    const events = await collect(adapter.stream(request()));

    expect(sentUrl).toBe("http://model.test/v1/chat/completions");
    expect(new Headers(sentInit?.headers).get("authorization")).toBe("Bearer secret-token");
    expect(JSON.parse(String(sentInit?.body))).toMatchObject({
      model: "qwen",
      stream: true,
      stream_options: { include_usage: true },
      chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: "user", content: "hello" }],
    });
    expect(events).toEqual([
      { type: "content-started", contentIndex: 0, contentType: "reasoning" },
      { type: "content-delta", contentIndex: 0, contentType: "reasoning", delta: "think" },
      { type: "content-started", contentIndex: 1, contentType: "text" },
      { type: "content-delta", contentIndex: 1, contentType: "text", delta: "你" },
      { type: "content-delta", contentIndex: 1, contentType: "text", delta: "好" },
      { type: "content-completed", contentIndex: 0, contentType: "reasoning" },
      { type: "content-completed", contentIndex: 1, contentType: "text" },
      { type: "usage", usage: { inputTokens: 3, outputTokens: 2, totalTokens: 5, reasoningTokens: 1 } },
      { type: "finished", reason: { kind: "stop" } },
    ]);
  });

  it("maps HTTP failures without copying provider response text", async () => {
    const adapter = new QwenChatCompletionsAdapter({
      baseUrl: "https://model.test/v1",
      fetch: async () => new Response("credential=do-not-copy", {
        status: 429,
        headers: { "retry-after": "2" },
      }),
    });

    await expect(collect(adapter.stream(request()))).rejects.toMatchObject({
      name: "LLMProviderError",
      code: "RATE_LIMIT",
      status: 429,
      retryAfterMs: 2_000,
    });
    await expect(collect(adapter.stream(request()))).rejects.not.toThrow("do-not-copy");
  });

  it("forwards an explicit thinking override to the Qwen chat template", async () => {
    let body: Record<string, unknown> = {};
    const adapter = new QwenChatCompletionsAdapter({
      baseUrl: "https://model.test/v1",
      enableThinking: true,
      fetch: async (_input, init) => {
        body = JSON.parse(String(init?.body));
        return sseResponse([
          "data: {\"choices\":[{\"delta\":{},\"finish_reason\":\"stop\"}]}\n\n",
          "data: [DONE]\n\n",
        ]);
      },
    });

    await collect(adapter.stream(request()));
    expect(body.chat_template_kwargs).toEqual({ enable_thinking: true });
  });

  it("ends without a finished event when the provider disconnects", async () => {
    const adapter = new QwenChatCompletionsAdapter({
      baseUrl: "https://model.test/v1",
      fetch: async () => sseResponse([
        "data: {\"choices\":[{\"delta\":{\"content\":\"partial\"},\"finish_reason\":null}]}\n\n",
      ]),
    });

    const events = await collect(adapter.stream(request()));
    expect(events).toEqual([
      { type: "content-started", contentIndex: 0, contentType: "text" },
      { type: "content-delta", contentIndex: 0, contentType: "text", delta: "partial" },
    ]);
  });

  it("drops an incomplete tool call when max tokens ends generation", async () => {
    const adapter = new QwenChatCompletionsAdapter({
      baseUrl: "https://model.test/v1",
      fetch: async () => sseResponse([
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"function\":{\"name\":\"read\",\"arguments\":\"{\"}}]},\"finish_reason\":\"length\"}]}\n\n",
        "data: [DONE]\n\n",
      ]),
    });

    const events = await collect(adapter.stream(request()));

    expect(events.map((event) => event.type)).toEqual([
      "content-started", "content-delta", "finished",
    ]);
    expect(events.at(-1)).toEqual({ type: "finished", reason: { kind: "max-tokens" } });
  });

  it("keeps a stable fallback id when the provider supplies its id late", async () => {
    const adapter = new QwenChatCompletionsAdapter({
      baseUrl: "https://model.test/v1",
      fetch: async () => sseResponse([
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"re\",\"arguments\":\"{\"}}]},\"finish_reason\":null}]}\n\n",
        "data: {\"choices\":[{\"delta\":{\"tool_calls\":[{\"index\":0,\"id\":\"call-1\",\"function\":{\"name\":\"ad\",\"arguments\":\"}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n",
        "data: [DONE]\n\n",
      ]),
    });

    const events = await collect(adapter.stream(request()));

    const generatedId = (events[0] as Extract<ModelEvent, {
      type: "content-started"; contentType: "tool-call";
    }>).toolCallId;
    expect(generatedId).toMatch(/^qwen-generated-/);
    expect(events).toEqual([
      { type: "content-started", contentIndex: 0, contentType: "tool-call",
        toolCallId: generatedId },
      { type: "content-delta", contentIndex: 0, contentType: "tool-call",
        toolCallId: generatedId, toolNameDelta: "re", delta: "{" },
      { type: "content-delta", contentIndex: 0, contentType: "tool-call",
        toolCallId: generatedId, toolNameDelta: "ad", delta: "}" },
      { type: "content-completed", contentIndex: 0, contentType: "tool-call" },
      { type: "finished", reason: { kind: "tool-calls" } },
    ]);
  });

  it("rejects one unterminated SSE event that exceeds the bound across chunks", async () => {
    const half = Math.floor(QWEN_SSE_MAX_EVENT_CHARS / 2) + 1;
    const adapter = new QwenChatCompletionsAdapter({
      baseUrl: "https://model.test/v1",
      fetch: async () => sseResponse([
        `data: ${"a".repeat(half)}`,
        "b".repeat(half),
      ]),
    });

    await expect(collect(adapter.stream(request()))).rejects.toMatchObject({
      name: "LLMProviderError",
      code: "TRANSPORT",
      message: "Qwen SSE event exceeds the size limit.",
    });
  });

  it("propagates the caller signal through fetch", async () => {
    const controller = new AbortController();
    let receivedSignal: AbortSignal | null | undefined;
    const adapter = new QwenChatCompletionsAdapter({
      baseUrl: "https://model.test/v1",
      fetch: async (_input, init) => {
        receivedSignal = init?.signal;
        return await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("cancelled", "AbortError")),
            { once: true },
          );
        });
      },
    });
    const pending = collect(adapter.stream(request(controller.signal)));
    await Promise.resolve();
    controller.abort("stop");

    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(receivedSignal).toBe(controller.signal);
  });

  it("rejects unsafe endpoint credentials", () => {
    expect(() => new QwenChatCompletionsAdapter({
      baseUrl: "https://user:password@model.test/v1",
    })).toThrow("without credentials");
    expect(() => new QwenChatCompletionsAdapter({
      baseUrl: "https://model.test/v1",
      apiKey: "bad\nkey",
    })).toThrow("must not contain newlines");
    expect(LLMProviderError).toBeDefined();
  });
});

function request(signal?: AbortSignal): GenerateRequest {
  return {
    provider: "qwen",
    model: "qwen",
    messages: [{
      id: createMessageId("user-1"),
      role: "user",
      content: [{ type: "text", text: "hello" }],
    }],
    ...(signal === undefined ? {} : { signal }),
  };
}

function sseResponse(chunks: readonly string[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
      controller.close();
    },
  }), { status: 200, headers: { "content-type": "text/event-stream" } });
}

async function collect(stream: AsyncIterable<ModelEvent>): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of stream) events.push(event);
  return events;
}
