import type { Context } from "cordis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createApp } from "../../src/app.js";
import {
  createMessageId,
  createSessionId,
  createToolCallId,
} from "../../src/brand/ids.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import type { JsonObject, ToolCallContentBlock } from "../../src/llm/types.js";
import { NODE_AGENT_TOOL_NAMES } from "../../src/node/profile.js";
import { READ_MAILBOX_TOOL_NAME } from "../../src/tools/builtins/mailbox/read.js";
import { SET_RESOURCE_ACCESS_TOOL_NAME } from "../../src/tools/builtins/resource/access.js";
import { MODIFY_ROADMAP_TOOL_NAME } from "../../src/tools/builtins/roadmap/modify-roadmap.js";
import { READ_NODE_TOOL_NAME } from "../../src/tools/builtins/roadmap/read-node.js";
import { READ_ROADMAP_TOOL_NAME } from "../../src/tools/builtins/roadmap/read.js";
import { WRITE_ROADMAP_TOOL_NAME } from "../../src/tools/builtins/roadmap/write-roadmap.js";
import { MockSearchAdapter } from "../../src/tools/builtins/search/adapters/mock.js";
import { modelResponse } from "../helpers/runtime.js";

let app: Context | undefined;

afterEach(async () => {
  await app?.fiber.dispose();
  app = undefined;
});

describe("Navo application integration", () => {
  it("runs a model-tool-model loop and rebuilds its context from Session", async () => {
    app = await createApp({
      node: { session: { model: { provider: "mock", model: "node-test" } } },
      tools: { search: { adapter: new MockSearchAdapter([]) } },
    });
    expect(app.tools.schemas().map((tool) => tool.name).sort())
      .toEqual([...NODE_AGENT_TOOL_NAMES, SET_RESOURCE_ACCESS_TOOL_NAME, READ_MAILBOX_TOOL_NAME, READ_ROADMAP_TOOL_NAME, READ_NODE_TOOL_NAME, WRITE_ROADMAP_TOOL_NAME, MODIFY_ROADMAP_TOOL_NAME].sort());
    expect(app.nodes).toBeDefined();
    expect(app.nodeSessions).toBeDefined();
    const sessionId = createSessionId("integration-loop");
    const userMessage = {
      id: createMessageId("integration-user"),
      role: "user" as const,
      content: [{ type: "text" as const, text: "Echo closed loop" }],
    };
    const toolCall: ToolCallContentBlock = {
      type: "tool-call",
      id: createToolCallId("integration-echo"),
      name: "echo",
      arguments: JSON.stringify({ text: "closed loop" }),
    };
    const adapter = new MockLLMAdapter([
      modelResponse([toolCall], "tool-calls"),
      modelResponse([{ type: "text", text: "FINAL: closed loop" }]),
    ]);
    const execute = vi.fn(async (arguments_: JsonObject) =>
      ({ content: String(arguments_.text) }));
    await app.plugin(Object.assign(
      (ctx: Context) => {
        const unregisterAdapter = ctx.llm.registerAdapter("mock", adapter);
        const unregisterTool = ctx.tools.register({
          name: "echo",
          description: "Return the provided text.",
          parameters: {
            type: "object",
            properties: { text: { type: "string" } },
            required: ["text"],
            additionalProperties: false,
          },
          execute,
        });
        return () => {
          unregisterTool();
          unregisterAdapter();
        };
      },
      { inject: ["llm", "tools"] },
    ));

    await expect(app.agentRuntime.runTurn({
      sessionId,
      userMessage,
      model: { provider: "mock", model: "integration" },
      toolNames: ["echo"],
    })).resolves.toMatchObject({ status: "completed", steps: 2 });

    expect(execute).toHaveBeenCalledOnce();
    expect(execute.mock.calls[0]?.[0]).toEqual({ text: "closed loop" });
    expect(adapter.requests).toHaveLength(2);
    expect(adapter.requests[0]?.messages).toEqual([userMessage]);
    expect(adapter.requests[0]?.tools).toEqual([
      expect.objectContaining({ name: "echo" }),
    ]);
    expect(adapter.requests[1]?.messages.map((message) => message.role))
      .toEqual(["user", "assistant", "user"]);
    expect(adapter.requests[1]?.messages[1]?.content).toEqual([toolCall]);
    expect(adapter.requests[1]?.messages[2]?.content).toEqual([{
      type: "tool-result",
      toolCallId: toolCall.id,
      content: [{ type: "text", text: "closed loop" }],
      isError: false,
    }]);
    expect(adapter.requests[1]?.tools).toEqual(adapter.requests[0]?.tools);

    const events = app.sessions.getEvents(sessionId);
    expect(events.map((event) => event.type)).toEqual([
      "turn-started",
      "user-message",
      "step-started",
      "llm-requested",
      "assistant-message",
      "tool-call-requested",
      "tool-call-result",
      "step-ended",
      "step-started",
      "llm-requested",
      "assistant-message",
      "step-ended",
      "turn-ended",
    ]);
    const requests = events.filter((event) => event.type === "llm-requested");
    expect(requests.map((event) => event.data.messages))
      .toEqual(adapter.requests.map((request) => request.messages));

    const rebuilt = app.sessions.deriveMessages(sessionId);
    expect(rebuilt.map((message) => message.role))
      .toEqual(["user", "assistant", "user", "assistant"]);
    expect(rebuilt.at(-1)?.content).toEqual([
      { type: "text", text: "FINAL: closed loop" },
    ]);
  });
});
