import { afterEach, describe, expect, it } from "vitest";

import { CONTENT_MAX_EVENTS } from "../../../../rpc/content.js";
import type { TurnEvent as RpcTurnEvent } from "../../../../rpc/content.js";
import { createTurnOutputValidator } from "../../../../rpc/content/stream.js";
import { createMessageId, createSessionId, createStepId, createToolCallId,
  createTurnId } from "../../../../src/brand/ids.js";
import { createAgentTurnV2Handler } from "../../../../src/host/turn/v2.js";
import { StreamEventQueue } from "../../../../src/host/turn/queue.js";
import { TurnOutput } from "../../../../src/agent/output.js";
import type { ModelEvent } from "../../../../src/llm/types.js";
import { createRuntime, disposeRuntimes } from "../../../helpers/runtime.js";

afterEach(disposeRuntimes);

const config = { model: { provider: "mock", model: "test" } };

describe("Kernel Host agent.turn.v2 output limits", () => {
  it("caps one content value without emitting an invalid frame", async () => {
    const text = "a".repeat(300_000);
    const events = await run(text, "budget-v2");
    const deltas = contentDeltas(events);

    expect(deltas.reduce((sum, delta) => sum + delta.length, 0)).toBe(262_144);
    expect(deltas.every((delta) => delta.length <= 16_384)).toBe(true);
    expect((events.at(-1) as { type: string }).type).toBe("turn-completed");
  });

  it("splits frames without cutting a UTF-16 surrogate pair", async () => {
    const text = `${"a".repeat(16_383)}😀tail`;
    const events = await run(text, "split-v2");
    const deltas = contentDeltas(events);

    expect(deltas.every((delta) => delta.length <= 16_384)).toBe(true);
    expect(deltas.join("")).toBe(text);
  });

  it("does not cut a surrogate pair at the content budget", async () => {
    const events = await runEvents([
      { type: "content-started", contentIndex: 0, contentType: "text" },
      { type: "content-delta", contentIndex: 0, contentType: "text",
        delta: "a".repeat(262_143) },
      { type: "content-delta", contentIndex: 0, contentType: "text", delta: "😀" },
      { type: "content-completed", contentIndex: 0, contentType: "text" },
      { type: "finished", reason: { kind: "stop" } },
    ], "surrogate-v2");
    const text = contentDeltas(events).join("");

    expect(text).toHaveLength(262_143);
    expect(text.charCodeAt(text.length - 1)).not.toBeGreaterThanOrEqual(0xd800);
  });

  it("continues with later content after one content reaches its limit", async () => {
    const events = await runEvents([
      { type: "content-started", contentIndex: 0, contentType: "text" },
      { type: "content-delta", contentIndex: 0, contentType: "text",
        delta: "a".repeat(300_000) },
      { type: "content-completed", contentIndex: 0, contentType: "text" },
      { type: "content-started", contentIndex: 1, contentType: "text" },
      { type: "content-delta", contentIndex: 1, contentType: "text", delta: "later" },
      { type: "content-completed", contentIndex: 1, contentType: "text" },
      { type: "finished", reason: { kind: "stop" } },
    ], "next-content-v2");

    expect(contentDeltas(events, 1).join("")).toBe("later");
  });

  it.each(["completed", "cancelled", "failed"] as const)(
    "reserves all completions for fragmented deltas on %s", async (status) => {
    const queue = new StreamEventQueue<RpcTurnEvent>();
    const turnId = createTurnId("event-turn");
    const output = new TurnOutput({ sessionId: "event-session", requestId: "event-request", turnId }, event => queue.push(event));
    const stepId = createStepId("event-step");
    const messageId = createMessageId("event-message");
    await output.start();
    await output.startStep(stepId, messageId);
    await output.model({ type: "content-started",
      contentIndex: 0, contentType: "text" });
    await output.model({ type: "content-started",
      contentIndex: 1, contentType: "reasoning" });

    let published = false;
    for (let index = 0; index < CONTENT_MAX_EVENTS - 8; index++) {
      published = await output.model({ type: "content-delta",
        contentIndex: 0, contentType: "text", delta: "x" });
    }
    expect(published).toBe(true);
    expect(await output.model({ type: "content-delta",
      contentIndex: 0, contentType: "text", delta: "x" })).toBe(true);
    expect(await output.model({ type: "content-delta",
      contentIndex: 0, contentType: "text", delta: "x" })).toBe(false);
    await output.endStep();
    await output.finish(status === "failed"
      ? { status, turnId, steps: 1, failure: { code: "SERVER", message: "failed" } }
      : { status, turnId, steps: 1 });
    queue.end();
    const validator = createTurnOutputValidator({
      sessionId: "event-session", requestId: "event-request", text: "test",
    });
    const events: RpcTurnEvent[] = [];
    for await (const event of queue) {
      validator.parse(event);
      events.push(event);
    }
    validator.end();
    expect(events).toHaveLength(CONTENT_MAX_EVENTS);
    expect(events.slice(-4).map(event => event.type)).toEqual([
      "content-completed", "content-completed", "step-completed", `turn-${status}`,
    ]);
  });

  it("bounds empty Step production without a separate Step limit", async () => {
    const queue = new StreamEventQueue<RpcTurnEvent>();
    const turnId = createTurnId("empty");
    const output = new TurnOutput({ sessionId: "empty", requestId: "empty", turnId }, event => queue.push(event));
    await output.start();
    const steps = (CONTENT_MAX_EVENTS - 2) / 2;
    for (let n = 0; n < steps; n++) {
      const scope = { turnId, stepId: createStepId(String(n)), messageId: createMessageId(String(n)) };
      await output.startStep(scope.stepId, scope.messageId);
      await output.endStep();
    }
    await expect(output.startStep("overflow", "overflow")).rejects.toThrow("event limit exceeded");
    await output.finish({
      status: "failed", turnId, steps: steps + 1,
      failure: { code: "runtime-failed", message: "output rejected" },
    });
    queue.end();
    const validator = createTurnOutputValidator({ sessionId: "empty", requestId: "empty", text: "test" });
    let count = 0;
    for await (const event of queue) {
      validator.parse(event);
      count++;
    }
    validator.end();
    expect(count).toBe(CONTENT_MAX_EVENTS);
  });

  it("fails at a new Step before another model request when lifecycle slots run out", async () => {
    const toolCallId = createToolCallId("next");
    const modelEvents: ModelEvent[] = [
      { type: "content-started", contentIndex: 0, contentType: "text" },
      ...Array.from({ length: CONTENT_MAX_EVENTS }, (): ModelEvent => ({
        type: "content-delta", contentIndex: 0, contentType: "text", delta: "x",
      })),
      { type: "content-completed", contentIndex: 0, contentType: "text" },
      { type: "content-started", contentIndex: 1, contentType: "tool-call", toolCallId },
      { type: "content-delta", contentIndex: 1, contentType: "tool-call", toolCallId,
        toolNameDelta: "not_allowed", delta: "{}" },
      { type: "content-completed", contentIndex: 1, contentType: "tool-call" },
      { type: "finished", reason: { kind: "tool-calls" } },
    ];
    const kit = await createRuntime([{ kind: "events", events: modelEvents }]);
    const input = { sessionId: "no-hidden-step", requestId: "budget", text: "test" };
    const validator = createTurnOutputValidator(input);
    const events: RpcTurnEvent[] = [];
    for await (const event of createAgentTurnV2Handler(kit.ctx, config)(input, new AbortController().signal)) {
      events.push(validator.parse(event));
    }
    validator.end();
    expect(events).toHaveLength(CONTENT_MAX_EVENTS);
    expect(events.at(-1)).toMatchObject({ type: "turn-failed",
      failure: { code: "resource-limit-exceeded" } });
    expect(events.filter(event => event.type === "step-started")).toHaveLength(1);
    expect(kit.adapter.requests).toHaveLength(1);
    const log = kit.ctx.sessions.getEvents(createSessionId(input.sessionId));
    expect(log.filter(event => event.type === "step-started")).toHaveLength(2);
    expect(log.filter(event => event.type === "step-ended")).toHaveLength(2);
    expect(log.at(-1)).toMatchObject({ type: "turn-ended", data: { status: "failed" } });
  });
});

async function run(text: string, suffix: string): Promise<unknown[]> {
  return runEvents([
    { type: "content-started", contentIndex: 0, contentType: "text" },
    { type: "content-delta", contentIndex: 0, contentType: "text", delta: text },
    { type: "content-completed", contentIndex: 0, contentType: "text" },
    { type: "finished", reason: { kind: "stop" } },
  ], suffix);
}

async function runEvents(modelEvents: readonly ModelEvent[], suffix: string): Promise<unknown[]> {
  const kit = await createRuntime([{ kind: "events", events: modelEvents }]);
  const handler = createAgentTurnV2Handler(kit.ctx, config);
  const events: unknown[] = [];
  for await (const event of handler({
    sessionId: `${suffix}-session`,
    requestId: `${suffix}-request`,
    text: "test",
  }, new AbortController().signal)) events.push(event);
  return events;
}

function contentDeltas(events: readonly unknown[], contentIndex?: number): string[] {
  return events
    .filter((event) => (event as { type: string; contentIndex?: number }).type === "content-delta"
      && (contentIndex === undefined
        || (event as { contentIndex?: number }).contentIndex === contentIndex))
    .map((event) => (event as { delta: string }).delta);
}
