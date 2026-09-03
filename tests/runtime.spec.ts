import { afterEach, describe, expect, it, vi } from "vitest";

import { createSessionId } from "../src/brand/ids.js";
import { TEST_TOOL_NAMES } from "../src/tools/testing.js";
import {
  assertClosed,
  createRuntime,
  disposeRuntimes,
  eventTypes,
  modelError,
  modelResponse,
  turnInput,
} from "./helpers/runtime.js";
import { toolCall } from "./helpers/tools.js";

afterEach(async () => {
  vi.useRealTimers();
  await disposeRuntimes();
});

describe("AgentRuntime", () => {
  it("serializes concurrent Turns through one Session Actor Inbox", async () => {
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const sessionId = createSessionId("shared-session");
    const kit = await createRuntime([
      {
        kind: "handler",
        handle: async function* () {
          firstStarted.resolve();
          await releaseFirst.promise;
          yield {
            type: "block-end",
            index: 0,
            block: { type: "text", text: "first answer" },
          };
          yield { type: "finish", reason: { kind: "stop" } };
        },
      },
      modelResponse([{ type: "text", text: "second answer" }]),
    ]);
    const first = kit.ctx.agentRuntime.runTurn({
      ...turnInput("first-concurrent"),
      sessionId,
    });
    await firstStarted.promise;
    const second = kit.ctx.agentRuntime.runTurn({
      ...turnInput("second-concurrent"),
      sessionId,
    });

    await Promise.resolve();
    expect(kit.adapter.requests).toHaveLength(1);
    expect(kit.ctx.sessions.getEvents(sessionId)
      .filter((event) => event.type === "turn-started"))
      .toHaveLength(1);

    releaseFirst.resolve();
    await expect(Promise.all([first, second])).resolves.toEqual([
      expect.objectContaining({ status: "completed" }),
      expect.objectContaining({ status: "completed" }),
    ]);
    expect(kit.adapter.requests).toHaveLength(2);
    expect(kit.adapter.requests[0]?.messages.map(messageText))
      .toEqual(["first-concurrent"]);
    expect(kit.adapter.requests[1]?.messages.map(messageText))
      .toEqual(["first-concurrent", "first answer", "second-concurrent"]);
    expect(kit.ctx.sessions.getEvents(sessionId)
      .filter((event) => event.type === "turn-started" || event.type === "turn-ended")
      .map((event) => event.type))
      .toEqual(["turn-started", "turn-ended", "turn-started", "turn-ended"]);
  });

  it("lets different Session Actors run concurrently", async () => {
    const firstStarted = Promise.withResolvers<void>();
    const releaseFirst = Promise.withResolvers<void>();
    const kit = await createRuntime([
      {
        kind: "handler",
        handle: async function* () {
          firstStarted.resolve();
          await releaseFirst.promise;
          yield { type: "finish", reason: { kind: "stop" } };
        },
      },
      modelResponse([{ type: "text", text: "independent" }]),
    ]);
    const first = kit.ctx.agentRuntime.runTurn(turnInput("actor-one"));
    await firstStarted.promise;

    await expect(kit.ctx.agentRuntime.runTurn(turnInput("actor-two")))
      .resolves.toMatchObject({ status: "completed" });
    expect(kit.adapter.requests).toHaveLength(2);

    releaseFirst.resolve();
    await expect(first).resolves.toMatchObject({ status: "completed" });
  });

  it("records a completed direct-answer Turn", async () => {
    const kit = await createRuntime([modelResponse([
      { type: "reasoning", text: "think" },
      { type: "text", text: "answer" },
    ])]);

    await expect(kit.ctx.agentRuntime.runTurn(turnInput("direct")))
      .resolves.toMatchObject({ status: "completed", steps: 1 });
    expect(eventTypes(kit, "direct")).toEqual([
      "turn-started", "user-message", "step-started", "llm-requested",
      "assistant-message", "step-ended", "turn-ended",
    ]);
    assertClosed(kit, "direct");
  });

  it("feeds the assistant call and tool result into the next request", async () => {
    const call = toolCall("echo", TEST_TOOL_NAMES.echo, { text: "hello" });
    const kit = await createRuntime([
      modelResponse([call], "tool-calls"),
      modelResponse([{ type: "text", text: "done" }]),
    ]);

    await expect(kit.ctx.agentRuntime.runTurn(turnInput("tool")))
      .resolves.toMatchObject({ status: "completed", steps: 2 });
    expect(kit.adapter.requests[1]?.messages.map((message) => message.role))
      .toEqual(["user", "assistant", "user"]);
    expect(kit.adapter.requests[1]?.messages.at(-1)?.content[0])
      .toMatchObject({ type: "tool-result", toolCallId: call.id });
    assertClosed(kit, "tool");
  });

  it("keeps multiple tool results ordered and exposes failures to the model", async () => {
    const calls = [
      toolCall("one", TEST_TOOL_NAMES.echo, { text: "one" }),
      toolCall("two", TEST_TOOL_NAMES.fail, {}),
      toolCall("three", TEST_TOOL_NAMES.echo, { text: "three" }),
    ];
    const kit = await createRuntime([
      modelResponse(calls, "tool-calls"),
      modelResponse([{ type: "text", text: "handled" }]),
    ]);

    await expect(kit.ctx.agentRuntime.runTurn(turnInput("tools")))
      .resolves.toMatchObject({ status: "completed", steps: 2 });
    const results = kit.ctx.sessions.getEvents(turnInput("tools").sessionId)
      .filter((event) => event.type === "tool-call-result");
    expect(results.map((event) => event.data.message.content[0].toolCallId))
      .toEqual(calls.map((call) => call.id));
    expect(results.map((event) => event.data.message.content[0].isError))
      .toEqual([false, true, false]);
    const errors = kit.ctx.sessions.getEvents(turnInput("tools").sessionId)
      .filter((event) => event.type === "error");
    expect(errors).toHaveLength(1);
    expect(errors[0]?.data).toMatchObject({
      source: "tool",
      toolCallId: calls[1]!.id,
      failure: { code: "tool-failed" },
    });
    assertClosed(kit, "tools");
  });

  it("ends one failed Step for a permanent model failure", async () => {
    const kit = await createRuntime([modelError("AUTH")]);

    await expect(kit.ctx.agentRuntime.runTurn(turnInput("failure")))
      .resolves.toMatchObject({ status: "failed", failure: { code: "AUTH" } });
    expect(kit.adapter.requests).toHaveLength(1);
    expect(kit.ctx.sessions.getEvents(turnInput("failure").sessionId)
      .find((event) => event.type === "error")?.data)
      .toMatchObject({ source: "llm", failure: { code: "AUTH" } });
    assertClosed(kit, "failure");
  });
});

function messageText(message: {
  readonly content: readonly {
    readonly type: string;
    readonly text?: string;
  }[];
}): string | undefined {
  const block = message.content.find((candidate) => candidate.type === "text");
  return block?.text;
}
