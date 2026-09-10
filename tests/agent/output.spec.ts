import { afterEach, describe, expect, it } from "vitest";
import { createTurnOutputValidator } from "../../rpc/content/stream.js";
import { DISPLAY_SUMMARY_MAX_CHARS, TOOL_DETAIL_MAX_CHARS } from "../../shared/content.js";
import type { TurnEvent } from "../../shared/content.js";
import { createToolCallId } from "../../src/brand/ids.js";
import type { ModelEvent } from "../../src/llm/types.js";
import { TEST_TOOL_NAMES } from "../../src/tools/testing.js";
import { createRuntime, disposeRuntimes, modelResponse, turnInput } from "../helpers/runtime.js";
import { toolCall } from "../helpers/tools.js";

afterEach(disposeRuntimes);

describe("Runtime public events", () => {
  it("emits directly valid public events with stable request and message identities", async () => {
    const kit = await createRuntime([modelResponse([
      { type: "reasoning", text: "think" }, { type: "text", text: "answer" },
    ])]);
    const input = { ...turnInput("public"), requestId: "caller-request" };
    const validator = createTurnOutputValidator({
      sessionId: input.sessionId, requestId: input.requestId, text: "public",
    });
    const events: TurnEvent[] = [];
    await kit.ctx.agentRuntime.runTurn({
      ...input,
      onEvent(event) {
        validator.parse(event);
        events.push(event);
      },
    });
    validator.end();
    expect(events.map(event => event.type)).toEqual([
      "turn-started", "step-started",
      "content-started", "content-delta", "content-completed",
      "content-started", "content-delta", "content-completed",
      "step-completed", "turn-completed",
    ]);
    expect(events.every(event => !("requestId" in event)
      || event.requestId === "caller-request")).toBe(true);
    const message = kit.ctx.sessions.getEvents(input.sessionId)
      .find(event => event.type === "assistant-message");
    expect(events[1]).toMatchObject({ messageId: message?.data.message.id });
  });

  it("closes partial content and the Step before publishing cancellation", async () => {
    const kit = await createRuntime([{ kind: "hang", eventsBeforeHang: [
      { type: "content-started", contentIndex: 0, contentType: "text" },
      { type: "content-delta", contentIndex: 0, contentType: "text", delta: "prefix" },
    ] }]);
    const input = turnInput("cancel-public");
    const controller = new AbortController();
    const validator = createTurnOutputValidator({
      sessionId: input.sessionId, requestId: input.userMessage.id, text: "cancel",
    });
    const events: string[] = [];
    await kit.ctx.agentRuntime.runTurn({
      ...input, signal: controller.signal,
      onEvent(event) {
        validator.parse(event);
        events.push(event.type);
        if (event.type === "content-delta") controller.abort();
        if (event.type === "turn-cancelled") {
          expect(kit.ctx.sessions.getEvents(input.sessionId).at(-1)?.type).toBe("turn-ended");
        }
      },
    });
    validator.end();
    expect(events.slice(-3)).toEqual(["content-completed", "step-completed", "turn-cancelled"]);
  });

  it("bounds public failure fields while retaining the internal result", async () => {
    const failure = { code: "E".repeat(200), message: "x".repeat(5000) };
    const kit = await createRuntime([{ kind: "events", events: [
      { type: "finished", reason: { kind: "error", failure } },
    ] }]);
    const input = turnInput("failure-public");
    const validator = createTurnOutputValidator({
      sessionId: input.sessionId, requestId: input.userMessage.id, text: "failure",
    });
    const events: TurnEvent[] = [];
    const result = await kit.ctx.agentRuntime.runTurn({
      ...input, onEvent(event) { events.push(validator.parse(event)); },
    });
    validator.end();
    expect(result).toMatchObject({ status: "failed", failure });
    expect(events.at(-1)).toMatchObject({
      type: "turn-failed", failure: { code: "E".repeat(128), message: "x".repeat(4096) },
    });
  });

  it("assembles fragmented tool names and arguments before executing", async () => {
    const toolCallId = createToolCallId("fragmented");
    const first: ModelEvent[] = [
      { type: "content-started", contentIndex: 0, contentType: "tool-call", toolCallId },
      { type: "content-delta", contentIndex: 0, contentType: "tool-call", toolCallId,
        toolNameDelta: "test_", delta: "{\"text\":" },
      { type: "content-delta", contentIndex: 0, contentType: "tool-call", toolCallId,
        toolNameDelta: "echo", delta: "\"hello\"}" },
      { type: "content-completed", contentIndex: 0, contentType: "tool-call" },
      { type: "finished", reason: { kind: "tool-calls" } },
    ];
    const kit = await createRuntime([
      { kind: "events", events: first },
      modelResponse([{ type: "text", text: "done" }]),
    ]);
    const input = { ...turnInput("tool-public"), requestId: "tool-request",
      toolNames: [TEST_TOOL_NAMES.echo] };
    const validator = createTurnOutputValidator({
      sessionId: input.sessionId, requestId: input.requestId, text: "tool",
    });
    const events: TurnEvent[] = [];

    await kit.ctx.agentRuntime.runTurn({
      ...input,
      onEvent(event) { events.push(validator.parse(event)); },
    });

    validator.end();
    const callStart = events.find(event => event.type === "content-started"
      && event.kind === "tool-call");
    const callDelta = events.find(event => event.type === "content-delta");
    const started = events.find(event => event.type === "tool-started");
    const result = events.find(event => event.type === "tool-result");
    expect(callStart).toMatchObject({ toolCallId, toolName: TEST_TOOL_NAMES.echo });
    expect(callDelta).toMatchObject({ delta: "{\"text\":\"hello\"}" });
    expect(started).toMatchObject({ toolCallId });
    expect(result).toMatchObject({
      toolCallId,
      status: "succeeded",
      summary: "hello",
      detail: "hello",
    });
    expect(events.indexOf(started!)).toBeLessThan(events.indexOf(result!));
  });

  it("reports cancellation after a tool has entered execution", async () => {
    const call = toolCall("cancelled", TEST_TOOL_NAMES.delay, {
      delayMs: 1_000,
      text: "late",
    });
    const kit = await createRuntime([modelResponse([call], "tool-calls")]);
    const input = { ...turnInput("tool-cancel"), requestId: "tool-cancel-request" };
    const controller = new AbortController();
    const validator = createTurnOutputValidator({
      sessionId: input.sessionId, requestId: input.requestId, text: "cancel",
    });
    const events: TurnEvent[] = [];

    const result = await kit.ctx.agentRuntime.runTurn({
      ...input,
      signal: controller.signal,
      toolNames: [TEST_TOOL_NAMES.delay],
      onEvent(event) {
        events.push(validator.parse(event));
        if (event.type === "tool-started") controller.abort("stop");
      },
    });

    validator.end();
    expect(result.status).toBe("cancelled");
    expect(events.find(event => event.type === "tool-result")).toMatchObject({
      toolCallId: call.id,
      status: "cancelled",
      failure: { code: "cancelled" },
    });
    expect(events.slice(-3).map(event => event.type)).toEqual([
      "tool-result", "step-completed", "turn-cancelled",
    ]);
  });

  it("settles completed calls without execution when output is truncated", async () => {
    const call = toolCall("truncated", TEST_TOOL_NAMES.echo, { text: "unused" });
    const kit = await createRuntime([modelResponse([call], "max-tokens")]);
    const input = { ...turnInput("tool-truncated"), requestId: "tool-truncated-request" };
    const validator = createTurnOutputValidator({
      sessionId: input.sessionId, requestId: input.requestId, text: "truncate",
    });
    const events: TurnEvent[] = [];

    await kit.ctx.agentRuntime.runTurn({
      ...input,
      toolNames: [TEST_TOOL_NAMES.echo],
      onEvent(event) { events.push(validator.parse(event)); },
    });

    validator.end();
    expect(events.some(event => event.type === "tool-started")).toBe(false);
    expect(events.find(event => event.type === "tool-result")).toMatchObject({
      status: "failed",
      failure: { code: "max-tokens" },
    });
    expect(events.at(-1)?.type).toBe("turn-truncated");
  });

  it("bounds public tool results while retaining the complete Session result", async () => {
    const call = toolCall("large", "large_output", {});
    const full = "x".repeat(100_000);
    const kit = await createRuntime([
      modelResponse([call], "tool-calls"),
      modelResponse([{ type: "text", text: "done" }]),
    ]);
    kit.ctx.tools.register({
      name: "large_output",
      parameters: { type: "object", additionalProperties: false },
      execute: () => full,
    });
    const input = { ...turnInput("tool-large"), requestId: "tool-large-request" };
    const validator = createTurnOutputValidator({
      sessionId: input.sessionId, requestId: input.requestId, text: "large",
    });
    const events: TurnEvent[] = [];

    await kit.ctx.agentRuntime.runTurn({
      ...input,
      toolNames: ["large_output"],
      onEvent(event) { events.push(validator.parse(event)); },
    });

    validator.end();
    expect(events.find(event => event.type === "tool-result")).toMatchObject({
      status: "succeeded",
      summary: "x".repeat(DISPLAY_SUMMARY_MAX_CHARS),
      detail: "x".repeat(TOOL_DETAIL_MAX_CHARS),
    });
    const persisted = kit.ctx.sessions.getEvents(input.sessionId)
      .find(event => event.type === "tool-call-result");
    expect(persisted?.data.message.content[0].content[0])
      .toMatchObject({ type: "text", text: full });
  });

  it("keeps private tool exceptions out of public failure events", async () => {
    const call = toolCall("private-failure", TEST_TOOL_NAMES.fail, {});
    const kit = await createRuntime([
      modelResponse([call], "tool-calls"),
      modelResponse([{ type: "text", text: "handled" }]),
    ]);
    const events: TurnEvent[] = [];

    await kit.ctx.agentRuntime.runTurn({
      ...turnInput("tool-private-failure"),
      toolNames: [TEST_TOOL_NAMES.fail],
      onEvent(event) { events.push(event); },
    });

    const result = events.find(event => event.type === "tool-result");
    expect(result).toMatchObject({
      status: "failed",
      failure: { code: "tool-failed" },
    });
    expect(JSON.stringify(result)).not.toContain("Test tool failed.");
    const stored = kit.ctx.sessions.getEvents(turnInput("tool-private-failure").sessionId)
      .find(event => event.type === "error");
    expect(stored?.data).toMatchObject({
      failure: { message: "Test tool failed." },
    });
  });
});
