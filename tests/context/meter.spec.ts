import { describe, expect, it } from "vitest";

import {
  createEventId,
  createMessageId,
  createSessionId,
  createStepId,
  createToolCallId,
  createTurnId,
} from "../../src/brand/ids.js";
import { estimateMessage, estimateRequest, estimateText, measureContext } from "../../src/context/meter.js";
import type { ContextRequest } from "../../src/context/meter.js";
import type { AssistantMessage, Message, TokenUsage, ToolSchema } from "../../src/llm/types.js";
import type { SessionEvent } from "../../src/session/types.js";

const sessionId = createSessionId("session-meter");
const turnId = createTurnId("turn-1");
const tools: readonly ToolSchema[] = [{ name: "read", description: "Read a file", parameters: { type: "object" } }];

describe("context text estimation", () => {
  it("counts dense CJK characters one token each and other text by four characters", () => {
    expect(estimateText("")).toBe(0);
    expect(estimateText("abcd")).toBe(1);
    expect(estimateText("abcde")).toBe(2);
    expect(estimateText("上下文压缩")).toBe(5);
    expect(estimateText("上下文 compaction")).toBe(3 + 3);
  });

  it("prices reasoning, tool calls, nested tool results and hidden replay items", () => {
    const plain = message("assistant", [{ type: "text", text: "done" }]);
    const reasoning = message("assistant", [{ type: "text", text: "done" }, { type: "reasoning", text: "x".repeat(400) }]);
    expect(estimateMessage(reasoning) - estimateMessage(plain)).toBe(4 + 100);

    const call = message("assistant", [{ type: "tool-call", id: createToolCallId("c1"), name: "read", arguments: "{\"path\":\"a.md\"}" }]);
    expect(estimateMessage(call)).toBe(4 + 4 + 1 + 4);

    const result = message("user", [{ type: "tool-result", toolCallId: createToolCallId("c1"), isError: false,
      content: [{ type: "text", text: "y".repeat(40) }] }]);
    expect(estimateMessage(result)).toBe(4 + 4 + 4 + 10);

    const visible = { contentIndex: 0, payload: { type: "message", text: "z".repeat(400) } };
    const hidden = { contentIndex: null, payload: { type: "reasoning", encrypted_content: "e".repeat(400) } };
    const replayed = { ...plain, replay: { version: 1 as const, protocol: "responses",
      source: { provider: "openai", model: "gpt" }, items: [visible, hidden] } };
    expect(estimateMessage(replayed) - estimateMessage(plain)).toBe(estimateText(JSON.stringify(hidden.payload)));
  });
});

describe("context measurement", () => {
  it("falls back to a full estimate without a usage anchor", () => {
    const current = request([system("prompt"), user("hello")]);
    expect(measureContext([], current)).toEqual({
      usedTokens: estimateRequest(current), estimatedRequestTokens: estimateRequest(current), basis: "estimate",
    });

    const reply = assistant("hi");
    const events = step("s1", current, reply, undefined);
    expect(measureContext(events, request([system("prompt"), user("hello"), reply]))).toMatchObject({ basis: "estimate" });
  });

  it("anchors on provider usage and adds the signed estimate of everything that changed since", () => {
    const first = request([system("prompt v1"), user("hello")]);
    const reply = assistant("calling a tool");
    const events = step("s1", first, reply, { inputTokens: 5_000, outputTokens: 300 });
    const toolResult = user("r".repeat(4_000));
    const next = request([system("prompt v2 with a longer Turn-start snapshot"), user("hello"), reply, toolResult]);

    const anchorEstimate = estimateRequest(first) + estimateMessage(reply);
    const measured = measureContext(events, next);
    expect(measured.basis).toBe("usage");
    expect(measured.usedTokens).toBe(5_300 + estimateRequest(next) - anchorEstimate);
    expect(measured.usedTokens - 5_300).toBe(
      estimateMessage(toolResult) + estimateMessage(next.messages[0]!) - estimateMessage(first.messages[0]!),
    );
  });

  it("never trusts usage below the heuristic price of the same anchored request", () => {
    const first = request([system("prompt"), user("u".repeat(8_000))]);
    const reply = assistant("ok");
    const events = step("s1", first, reply, { inputTokens: 10, outputTokens: 1 });
    const next = request([system("prompt"), user("u".repeat(8_000)), reply, user("next")]);
    expect(measureContext(events, next)).toEqual({
      usedTokens: estimateRequest(next), estimatedRequestTokens: estimateRequest(next), basis: "estimate",
    });
  });

  it("uses the last request of the anchored step after retries and shrinks after a surface replacement", () => {
    const retried = request([system("prompt"), user("long ".repeat(1_000))]);
    const reply = assistant("answer");
    const events = [
      ...step("s0", request([system("old")]), assistant("old"), { inputTokens: 1, outputTokens: 1 }),
      requested("s1", request([system("first attempt")])),
      ...step("s1", retried, reply, { inputTokens: 9_000, outputTokens: 100 }),
    ];
    const compacted = request([system("prompt"), user("summary"), reply]);
    const measured = measureContext(events, compacted);
    expect(measured.usedTokens).toBe(9_100 + estimateRequest(compacted) - estimateRequest(retried) - estimateMessage(reply));
    expect(measured.usedTokens).toBeLessThan(9_100);
  });

  it("drops the anchor when the model route changes", () => {
    const first = request([system("prompt"), user("hello")]);
    const reply = assistant("hi");
    const events = step("s1", first, reply, { inputTokens: 50_000, outputTokens: 10 });
    const switched = { ...request([system("prompt"), user("hello"), reply]), model: "other-model" };
    expect(measureContext(events, switched)).toMatchObject({ basis: "estimate", usedTokens: estimateRequest(switched) });
  });
});

let sequence = 0;

function step(stepId: string, sent: ContextRequest, reply: AssistantMessage, usage: TokenUsage | undefined): SessionEvent[] {
  return [requested(stepId, sent), record({ type: "assistant-message", data: {
    turnId, stepId: createStepId(stepId), message: reply, finishReason: { kind: "stop" },
    ...(usage === undefined ? {} : { usage }),
  } })];
}

function requested(stepId: string, sent: ContextRequest): SessionEvent {
  return record({ type: "llm-requested", data: {
    turnId, stepId: createStepId(stepId), provider: sent.provider, model: sent.model,
    messages: sent.messages, ...(sent.tools === undefined ? {} : { tools: sent.tools }),
  } });
}

function record(event: Pick<SessionEvent, "type" | "data">): SessionEvent {
  sequence += 1;
  return { id: createEventId(`event-${sequence}`), sessionId, sequence, timestamp: new Date(0).toISOString(), ...event } as SessionEvent;
}

function request(messages: readonly Message[]): ContextRequest {
  return { provider: "qwen", model: "qwen3.8-27b", messages, tools };
}

function system(text: string): Message {
  return message("system", [{ type: "text", text }]);
}

function user(text: string): Message {
  return message("user", [{ type: "text", text }]);
}

function assistant(text: string): AssistantMessage {
  return message("assistant", [{ type: "text", text }]) as AssistantMessage;
}

function message(role: Message["role"], content: Message["content"]): Message {
  sequence += 1;
  return { id: createMessageId(`message-${sequence}`), role, content };
}
