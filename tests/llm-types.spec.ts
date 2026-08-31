import { describe, expect, it } from "vitest";

import {
  createEventId,
  createMessageId,
  createSessionId,
  createStepId,
  createToolCallId,
  createTurnId,
} from "../src/brand/ids.js";
import type { GenerateRequest, GenerateResponse } from "../src/llm/types.js";

const idFactories = [
  ["SessionId", createSessionId],
  ["MessageId", createMessageId],
  ["EventId", createEventId],
  ["ToolCallId", createToolCallId],
  ["TurnId", createTurnId],
  ["StepId", createStepId],
] as const;

describe("branded IDs", () => {
  it.each(idFactories)("keeps %s as a runtime string", (_name, createId) => {
    const id = createId("id-1");

    expect(typeof id).toBe("string");
    expect(id).toBe("id-1");
    expect(JSON.stringify({ id })).toBe('{"id":"id-1"}');
  });

  it.each(idFactories)("rejects an empty %s", (_name, createId) => {
    expect(() => createId("")).toThrow(TypeError);
  });
});

describe("LLM protocol", () => {
  it("serializes a tool-use conversation without losing canonical facts", () => {
    const userMessageId = createMessageId("message-user");
    const assistantMessageId = createMessageId("message-assistant-tool");
    const toolMessageId = createMessageId("message-tool-result");
    const finalMessageId = createMessageId("message-assistant-final");
    const toolCallId = createToolCallId("call-weather-1");

    const request: GenerateRequest = {
      provider: "example-provider",
      model: "example-model",
      tools: [{
        name: "weather",
        description: "查询城市天气",
        parameters: {
          type: "object",
          properties: {
            city: { type: "string" },
          },
          required: ["city"],
        },
      }],
      messages: [
        {
          id: userMessageId,
          role: "user",
          content: [{ type: "text", text: "北京天气怎么样？" }],
        },
        {
          id: assistantMessageId,
          role: "assistant",
          content: [
            { type: "reasoning", text: "需要查询天气工具。" },
            {
              type: "tool-call",
              id: toolCallId,
              name: "weather",
              arguments: '{"city":"北京"}',
            },
          ],
        },
        {
          id: toolMessageId,
          role: "user",
          content: [{
            type: "tool-result",
            toolCallId,
            content: [{ type: "text", text: "晴，20°C" }],
            isError: false,
          }],
        },
      ],
    };

    const response: GenerateResponse = {
      message: {
        id: finalMessageId,
        role: "assistant",
        content: [{ type: "text", text: "北京当前晴，20°C。" }],
      },
      finishReason: { kind: "stop" },
      usage: {
        inputTokens: 100,
        outputTokens: 20,
        totalTokens: 120,
        reasoningTokens: 10,
      },
    };

    const payload = { request, response };
    const firstJson = JSON.stringify(payload);
    const restored = JSON.parse(firstJson);

    expect(JSON.stringify(payload)).toBe(firstJson);
    expect(restored).toEqual(payload);
    expect(restored.request.messages[1].content[0]).toEqual({
      type: "reasoning",
      text: "需要查询天气工具。",
    });
    expect(restored.request.messages[1].content[1].id).toBe("call-weather-1");
    expect(restored.request.messages[2].content[0].toolCallId).toBe("call-weather-1");
  });
});
