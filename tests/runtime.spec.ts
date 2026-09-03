import { afterEach, describe, expect, it, vi } from "vitest";

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
    assertClosed(kit, "tools");
  });

  it("ends one failed Step for a permanent model failure", async () => {
    const kit = await createRuntime([modelError("AUTH")]);

    await expect(kit.ctx.agentRuntime.runTurn(turnInput("failure")))
      .resolves.toMatchObject({ status: "failed", failure: { code: "AUTH" } });
    expect(kit.adapter.requests).toHaveLength(1);
    assertClosed(kit, "failure");
  });
});
