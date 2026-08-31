import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMessageId,
  createSessionId,
  createStepId,
  createToolCallId,
  createTurnId,
} from "../src/brand/ids.js";
import { projectMessages } from "../src/session/projector.js";
import { SessionStore } from "../src/session/store.js";
import type { SessionEvent } from "../src/session/types.js";

const contexts = new Set<Context>();

async function createMixedLog(): Promise<readonly SessionEvent[]> {
  const ctx = new Context();
  contexts.add(ctx);
  await ctx.plugin(SessionStore);

  const sessionId = createSessionId("session-projector");
  const turnId = createTurnId("turn-projector");
  const firstStepId = createStepId("step-tools");
  const finalStepId = createStepId("step-final");
  const firstToolCallId = createToolCallId("call-weather");
  const secondToolCallId = createToolCallId("call-time");

  ctx.sessions.append({
    sessionId,
    type: "turn-started",
    data: { turnId },
  });
  ctx.sessions.append({
    sessionId,
    type: "user-message",
    data: {
      message: {
        id: createMessageId("message-user"),
        role: "user",
        content: [{ type: "text", text: "查询北京天气和时间" }],
      },
    },
  });
  ctx.sessions.append({
    sessionId,
    type: "step-started",
    data: { turnId, stepId: firstStepId },
  });
  ctx.sessions.append({
    sessionId,
    type: "llm-requested",
    data: {
      turnId,
      stepId: firstStepId,
      provider: "test-provider",
      model: "test-model",
      messages: [],
    },
  });
  ctx.sessions.append({
    sessionId,
    type: "assistant-message",
    data: {
      turnId,
      stepId: firstStepId,
      message: {
        id: createMessageId("message-assistant-tools"),
        role: "assistant",
        content: [
          { type: "reasoning", text: "需要查询天气和时间工具。" },
          {
            type: "tool-call",
            id: firstToolCallId,
            name: "weather",
            arguments: '{"city":"北京"}',
          },
          {
            type: "tool-call",
            id: secondToolCallId,
            name: "time",
            arguments: '{"city":"北京"}',
          },
        ],
      },
      finishReason: { kind: "tool-calls" },
    },
  });
  ctx.sessions.append({
    sessionId,
    type: "tool-call-requested",
    data: {
      turnId,
      stepId: firstStepId,
      toolCall: {
        type: "tool-call",
        id: firstToolCallId,
        name: "weather",
        arguments: '{"city":"北京"}',
      },
    },
  });
  ctx.sessions.append({
    sessionId,
    type: "tool-call-requested",
    data: {
      turnId,
      stepId: firstStepId,
      toolCall: {
        type: "tool-call",
        id: secondToolCallId,
        name: "time",
        arguments: '{"city":"北京"}',
      },
    },
  });
  ctx.sessions.append({
    sessionId,
    type: "tool-call-result",
    data: {
      turnId,
      stepId: firstStepId,
      message: {
        id: createMessageId("message-tool-weather"),
        role: "user",
        content: [{
          type: "tool-result",
          toolCallId: firstToolCallId,
          content: [{ type: "text", text: "晴，20°C" }],
          isError: false,
        }],
      },
    },
  });
  ctx.sessions.append({
    sessionId,
    type: "error",
    data: {
      turnId,
      stepId: firstStepId,
      source: "runtime",
      failure: { code: "OBSERVED", message: "log-only diagnostic" },
    },
  });
  ctx.sessions.append({
    sessionId,
    type: "tool-call-result",
    data: {
      turnId,
      stepId: firstStepId,
      message: {
        id: createMessageId("message-tool-time"),
        role: "user",
        content: [{
          type: "tool-result",
          toolCallId: secondToolCallId,
          content: [{ type: "text", text: "14:30" }],
          isError: false,
        }],
      },
    },
  });
  ctx.sessions.append({
    sessionId,
    type: "step-ended",
    data: { turnId, stepId: firstStepId, status: "continue" },
  });
  ctx.sessions.append({
    sessionId,
    type: "step-started",
    data: { turnId, stepId: finalStepId },
  });
  ctx.sessions.append({
    sessionId,
    type: "assistant-message",
    data: {
      turnId,
      stepId: finalStepId,
      message: {
        id: createMessageId("message-assistant-empty"),
        role: "assistant",
        content: [],
      },
      finishReason: { kind: "max-tokens" },
      usage: { inputTokens: 10, outputTokens: 0 },
    },
  });
  ctx.sessions.append({
    sessionId,
    type: "llm-requested",
    data: {
      turnId,
      stepId: finalStepId,
      provider: "test-provider",
      model: "test-model",
      messages: [],
    },
  });
  ctx.sessions.append({
    sessionId,
    type: "assistant-message",
    data: {
      turnId,
      stepId: finalStepId,
      message: {
        id: createMessageId("message-assistant-final"),
        role: "assistant",
        content: [{ type: "text", text: "北京晴，20°C，当前时间 14:30。" }],
      },
      finishReason: { kind: "stop" },
    },
  });
  ctx.sessions.append({
    sessionId,
    type: "step-ended",
    data: { turnId, stepId: finalStepId, status: "completed" },
  });
  ctx.sessions.append({
    sessionId,
    type: "turn-ended",
    data: { turnId, status: "completed" },
  });

  return ctx.sessions.getEvents(sessionId);
}

afterEach(async () => {
  await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
  contexts.clear();
});

describe("projectMessages", () => {
  it("projects only model-visible events and excludes empty assistant messages", async () => {
    const messages = projectMessages(await createMixedLog());

    expect(messages.map((message) => message.id)).toEqual([
      "message-user",
      "message-assistant-tools",
      "message-tool-weather",
      "message-tool-time",
      "message-assistant-final",
    ]);
  });

  it("preserves reasoning and tool calls inside the assistant message", async () => {
    const messages = projectMessages(await createMixedLog());

    expect(messages[1]?.content).toEqual([
      { type: "reasoning", text: "需要查询天气和时间工具。" },
      {
        type: "tool-call",
        id: "call-weather",
        name: "weather",
        arguments: '{"city":"北京"}',
      },
      {
        type: "tool-call",
        id: "call-time",
        name: "time",
        arguments: '{"city":"北京"}',
      },
    ]);
  });

  it("keeps tool results in committed event order with their call correlation", async () => {
    const messages = projectMessages(await createMixedLog());

    expect(messages.slice(2, 4).map((message) => message.content[0])).toEqual([
      {
        type: "tool-result",
        toolCallId: "call-weather",
        content: [{ type: "text", text: "晴，20°C" }],
        isError: false,
      },
      {
        type: "tool-result",
        toolCallId: "call-time",
        content: [{ type: "text", text: "14:30" }],
        isError: false,
      },
    ]);
  });

  it("rebuilds deterministically from the same prefix and a detached full log", async () => {
    const events = await createMixedLog();
    const prefix = events.slice(0, 10);
    const firstPrefixProjection = projectMessages(prefix);

    expect(projectMessages(prefix)).toEqual(firstPrefixProjection);
    expect(projectMessages(structuredClone(events) as SessionEvent[])).toEqual(
      projectMessages(events),
    );
    expect(projectMessages(prefix)).toEqual(firstPrefixProjection);
  });
});
