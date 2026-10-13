import { describe, expect, it } from "vitest";

import { createMessageId } from "../../../src/brand/ids.js";
import { serializeChatCompletionsRequest } from "../../../src/llm/protocols/completions/request.js";
import { translateChatCompletionsSse } from "../../../src/llm/protocols/completions/stream.js";
import type { GenerateRequest, ModelEvent } from "../../../src/llm/types.js";

describe("Chat Completions protocol", () => {
  it("serializes a provider-neutral request without Qwen fields", () => {
    const body = serializeChatCompletionsRequest(request());

    expect(body).toMatchObject({
      model: "other-model",
      stream: true,
      stream_options: { include_usage: true },
      messages: [{ role: "user", content: "hello" }],
    });
    expect(body).not.toHaveProperty("chat_template_kwargs");
  });

  it("adds reasoning only when the adapter selects the explicit field", () => {
    const requestWithReasoning: GenerateRequest = {
      ...request(),
      messages: [{
        id: createMessageId("assistant-1"),
        role: "assistant",
        content: [
          { type: "reasoning", text: "think" },
          { type: "text", text: "answer" },
        ],
      }],
    };
    const body = serializeChatCompletionsRequest(requestWithReasoning, {
      reasoningField: "reasoning_content",
    });
    const defaultBody = serializeChatCompletionsRequest(requestWithReasoning);

    expect(body.messages).toEqual([{
      role: "assistant",
      content: "answer",
      reasoning_content: "think",
    }]);
    expect(body).not.toHaveProperty("chat_template_kwargs");
    expect(defaultBody.messages).toEqual([{
      role: "assistant",
      content: "answer",
    }]);
    expect(defaultBody.messages).not.toEqual(expect.arrayContaining([
      expect.objectContaining({ reasoning_content: expect.anything() }),
    ]));
  });

  it("reuses the stream codec with another configuration", async () => {
    const events = await collect(translateChatCompletionsSse(sseResponse([
      "data: {\"choices\":[{\"delta\":{\"reasoning\":\"hidden\",\"tool_calls\":[{\"index\":0,\"function\":{\"name\":\"read\",\"arguments\":\"{}\"}}]},\"finish_reason\":\"tool_calls\"}]}\n\n",
      "data: [DONE]\n\n",
    ]).body!, {
      errorLabel: "Other",
      generatedToolCallIdPrefix: "other-generated",
    }));
    const generatedId = (events[0] as Extract<ModelEvent, {
      type: "content-started"; contentType: "tool-call";
    }>).toolCallId;
    expect(generatedId).toMatch(/^other-generated-/);

    expect(events).toEqual([
      { type: "content-started", contentIndex: 0, contentType: "tool-call",
        toolCallId: generatedId },
      { type: "content-delta", contentIndex: 0, contentType: "tool-call",
        toolCallId: generatedId,
        toolNameDelta: "read", delta: "{}" },
      { type: "content-completed", contentIndex: 0, contentType: "tool-call" },
      { type: "finished", reason: { kind: "tool-calls" } },
    ]);
    expect(events).not.toContainEqual(expect.objectContaining({ delta: "hidden" }));
  });
});

function request(): GenerateRequest {
  return {
    provider: "other",
    model: "other-model",
    messages: [{
      id: createMessageId("user-1"),
      role: "user",
      content: [{ type: "text", text: "hello" }],
    }],
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
