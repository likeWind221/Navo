import { afterEach, describe, expect, it, vi } from "vitest";

import { createToolCallId } from "../../src/brand/ids.js";
import { TEST_TOOL_NAMES } from "../../src/tools/testing.js";
import {
  assertClosed,
  createRuntime,
  disposeRuntimes,
  eventTypes,
  modelError,
  modelResponse,
  turnInput,
} from "../helpers/runtime.js";
import { toolCall } from "../helpers/tools.js";

afterEach(async () => {
  vi.useRealTimers();
  await disposeRuntimes();
});

describe("AgentRuntime resilience", () => {
  it("blocks before opening a Step beyond the configured limit", async () => {
    const call = toolCall("limited", "test_echo", { text: "again" });
    const kit = await createRuntime([modelResponse([call], "tool-calls")]);

    await expect(kit.ctx.agentRuntime.runTurn({
      ...turnInput("limit"),
      toolNames: [TEST_TOOL_NAMES.echo],
      limits: { maxSteps: 1 },
    })).resolves.toMatchObject({
      status: "blocked",
      steps: 1,
      failure: { code: "max-steps-exceeded" },
    });
    expect(eventTypes(kit, "limit").filter((type) => type === "step-started"))
      .toHaveLength(1);
    expect(kit.ctx.sessions.getEvents(turnInput("limit").sessionId)
      .find((event) => event.type === "error")?.data)
      .toMatchObject({ source: "runtime", failure: { code: "max-steps-exceeded" } });
    assertClosed(kit, "limit");
  });

  it("retries inside one Step and discards a failed attempt's partial output", async () => {
    vi.useFakeTimers();
    const kit = await createRuntime([
      {
        kind: "error",
        error: new Error("connection dropped"),
        eventsBeforeError: [
          { type: "content-started", contentIndex: 0, contentType: "reasoning" },
          { type: "content-delta", contentIndex: 0,
            contentType: "reasoning", delta: "discard me" },
          { type: "content-completed", contentIndex: 0, contentType: "reasoning" },
        ],
      },
      modelResponse([{ type: "text", text: "recovered" }]),
    ]);

    const pending = kit.ctx.agentRuntime.runTurn({
      ...turnInput("retry"),
      limits: { maxModelRetries: 1 },
    });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ status: "completed", steps: 1 });
    const events = kit.ctx.sessions.getEvents(turnInput("retry").sessionId);
    const requests = events.filter((event) => event.type === "llm-requested");
    const messages = events.filter((event) => event.type === "assistant-message");
    expect(requests).toHaveLength(2);
    expect(new Set(requests.map((event) => event.data.stepId)).size).toBe(1);
    expect(messages).toHaveLength(1);
    expect(messages[0]?.data.message.content)
      .toEqual([{ type: "text", text: "recovered" }]);
    assertClosed(kit, "retry");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("does not retry after publishing live content from an attempt", async () => {
    const kit = await createRuntime([
      {
        kind: "error",
        error: new Error("connection dropped"),
        eventsBeforeError: [
          { type: "content-started", contentIndex: 0, contentType: "reasoning" },
          { type: "content-delta", contentIndex: 0,
            contentType: "reasoning", delta: "visible" },
        ],
      },
      modelResponse([{ type: "text", text: "must not retry" }]),
    ]);
    const live: string[] = [];

    const result = await kit.ctx.agentRuntime.runTurn({
      ...turnInput("published"),
      limits: { maxModelRetries: 1 },
      onEvent: (event) => { live.push(event.type); },
    });

    expect(result).toMatchObject({
      status: "failed",
      failure: { code: "stream-output-interrupted" },
    });
    expect(kit.adapter.requests).toHaveLength(1);
    expect(live.filter((type) => type === "content-started")).toHaveLength(1);
    assertClosed(kit, "published");
  });

  it("stops after the exact transient retry budget is exhausted", async () => {
    vi.useFakeTimers();
    const kit = await createRuntime([
      modelError("SERVER"), modelError("SERVER"), modelError("SERVER"),
    ]);

    const pending = kit.ctx.agentRuntime.runTurn({
      ...turnInput("exhausted"),
      limits: { maxModelRetries: 2 },
    });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({
      status: "failed",
      steps: 1,
      failure: { code: "SERVER" },
    });
    expect(kit.adapter.requests).toHaveLength(3);
    assertClosed(kit, "exhausted");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets cancellation win while waiting to retry", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const kit = await createRuntime([
      modelError("SERVER"),
      modelResponse([{ type: "text", text: "must not run" }]),
    ]);

    const pending = kit.ctx.agentRuntime.runTurn({
      ...turnInput("backoff"),
      signal: controller.signal,
    });
    await flushUntil(() => vi.getTimerCount() > 0);
    controller.abort("stop retrying");
    await expect(pending).resolves.toMatchObject({ status: "cancelled", steps: 1 });
    expect(kit.adapter.requests).toHaveLength(1);
    assertClosed(kit, "backoff");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("times out a hanging model and clears its deadline", async () => {
    vi.useFakeTimers();
    const kit = await createRuntime([{ kind: "hang" }]);

    const pending = kit.ctx.agentRuntime.runTurn({
      ...turnInput("timeout"),
      limits: { modelTimeoutMs: 50, maxModelRetries: 0 },
    });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({
      status: "failed",
      failure: { code: "TIMEOUT" },
    });
    assertClosed(kit, "timeout");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a hanging model without persisting an assistant message", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const kit = await createRuntime([{ kind: "hang" }]);
    const pending = kit.ctx.agentRuntime.runTurn({
      ...turnInput("cancel"),
      signal: controller.signal,
    });

    await flushUntil(() => kit.adapter.requests.length === 1);
    controller.abort("user cancelled");
    await expect(pending).resolves.toMatchObject({ status: "cancelled", steps: 1 });
    expect(eventTypes(kit, "cancel")).not.toContain("assistant-message");
    assertClosed(kit, "cancel");
    expect(vi.getTimerCount()).toBe(0);
  });

  it("records a cancelled result for a tool that was already accepted", async () => {
    const controller = new AbortController();
    const kit = await createRuntime([
      modelResponse([toolCall("held", "hold", {})], "tool-calls"),
    ]);
    const started = Promise.withResolvers<void>();
    kit.ctx.tools.register({
      name: "hold",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async (_arguments, { signal }) => {
        started.resolve();
        await aborted(signal);
        return "unreachable";
      },
    });
    const pending = kit.ctx.agentRuntime.runTurn({
      ...turnInput("toolcancel"),
      toolNames: ["hold"],
      signal: controller.signal,
    });

    await started.promise;
    controller.abort("stop tool");
    await expect(pending).resolves.toMatchObject({ status: "cancelled", steps: 1 });
    const events = kit.ctx.sessions.getEvents(turnInput("toolcancel").sessionId);
    const result = events.find((event) => event.type === "tool-call-result");
    expect(result?.data.message.content[0])
      .toMatchObject({ toolCallId: createToolCallId("held"), isError: true });
    assertClosed(kit, "toolcancel");
  });

  it("does not open a Step for an already cancelled Turn", async () => {
    const kit = await createRuntime([]);
    const result = await kit.ctx.agentRuntime.runTurn({
      ...turnInput("precancel"),
      signal: AbortSignal.abort("already cancelled"),
    });

    expect(result).toMatchObject({ status: "cancelled", steps: 0 });
    expect(eventTypes(kit, "precancel")).toEqual([
      "turn-started", "user-message", "turn-ended",
    ]);
    assertClosed(kit, "precancel");
  });

  it.each(["max-tokens", "content-filter"] as const)(
    "persists partial output and blocks the Turn on %s",
    async (finish) => {
      const kit = await createRuntime([
        modelResponse([{ type: "text", text: "partial" }], finish),
      ]);
      const result = await kit.ctx.agentRuntime.runTurn(turnInput(finish));

      expect(result).toMatchObject({
        status: "blocked",
        steps: 1,
        failure: { code: finish },
      });
      const events = kit.ctx.sessions.getEvents(turnInput(finish).sessionId);
      expect(events.find((event) => event.type === "assistant-message"))
        .toBeDefined();
      expect(events.find((event) => event.type === "step-ended")?.data.status)
        .toBe("blocked");
      assertClosed(kit, finish);
    },
  );

  it("pairs a completed max-tokens tool call with a not-executed result", async () => {
    const call = toolCall("truncated", "must_not_run", {});
    const kit = await createRuntime([
      modelResponse([call], "max-tokens"),
      modelResponse([{ type: "text", text: "recovered" }]),
    ]);
    let executions = 0;
    kit.ctx.tools.register({
      name: "must_not_run",
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => {
        executions += 1;
        return "unexpected";
      },
    });

    const first = await kit.ctx.agentRuntime.runTurn(turnInput("truncated-pair"));

    expect(first).toMatchObject({ status: "blocked", failure: { code: "max-tokens" } });
    expect(executions).toBe(0);
    const events = kit.ctx.sessions.getEvents(turnInput("truncated-pair").sessionId);
    expect(events.find((event) => event.type === "tool-call-result")?.data.message.content[0])
      .toMatchObject({ toolCallId: call.id, isError: true });
    expect(events.find((event) => event.type === "error")?.data)
      .toMatchObject({ source: "llm", failure: { code: "max-tokens" } });
    expect(kit.ctx.sessions.deriveMessages(turnInput("truncated-pair").sessionId)
      .map((message) => message.role))
      .toEqual(["user", "assistant", "user"]);

    await expect(kit.ctx.agentRuntime.runTurn(turnInput("truncated-pair")))
      .resolves.toMatchObject({ status: "completed" });
    expect(kit.adapter.requests[1]?.messages.map((message) => message.role))
      .toEqual(["user", "assistant", "user", "user"]);
  });
});

async function flushUntil(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 20 && !condition(); index += 1) {
    await Promise.resolve();
  }
  if (!condition()) throw new Error("Expected asynchronous boundary was not reached.");
}

function aborted(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(new Error("aborted"));
  return new Promise((_, reject) => {
    signal.addEventListener("abort", () => reject(new Error("aborted")), {
      once: true,
    });
  });
}
