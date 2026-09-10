import { describe, expect, it } from "vitest";

import type { DesktopAgentTurnUpdate } from "../../../../../shared/agent.js";
import type { AgentTurnV2Event } from "../../../../../../rpc/content.js";
import {
  conversationReducer,
  initialConversationState,
} from "../../conversation.js";
import type { ConversationState } from "../../conversation.js";

describe("conversationReducer", () => {
  it("adds the user message and assistant placeholder atomically", () => {
    const state = submitted();

    expect(state.messages).toEqual([
      { id: "user-1", role: "user", text: "你好" },
      { id: "assistant-1", role: "assistant", text: "", status: "waiting", failure: null },
    ]);
    expect(state.activeTurn).toEqual({
      requestId: "request-1",
      assistantMessageId: "assistant-1",
      turnId: null,
    });
    expect(state.timeline).toEqual([
      { kind: "message", id: "user-1" },
      { kind: "message", id: "assistant-1" },
    ]);
  });

  it("rejects another submission while a turn is active", () => {
    const state = submitted();
    const duplicate = conversationReducer(state, {
      type: "turn-submitted",
      requestId: "request-2",
      userMessageId: "user-2",
      assistantMessageId: "assistant-2",
      text: "第二条",
    });

    expect(duplicate).toBe(state);
  });

  it("records the turn id and appends text deltas in order", () => {
    const started = update(submitted(), "request-1", { type: "started", turnId: "turn-1" });
    const first = update(started, "request-1", { type: "text-delta", text: "你" });
    const second = update(first, "request-1", { type: "text-delta", text: "好" });

    expect(second.activeTurn?.turnId).toBe("turn-1");
    expect(second.messages.at(-1)).toMatchObject({ text: "你好", status: "streaming" });
  });

  it("ignores updates belonging to an old request", () => {
    const state = submitted();
    const stale = update(state, "old-request", { type: "text-delta", text: "迟到内容" });

    expect(stale).toBe(state);
  });

  it("ignores a delta that arrives after the business terminal", () => {
    const completed = update(submitted(), "request-1", { type: "completed" });
    const late = update(completed, "request-1", { type: "text-delta", text: "迟到内容" });

    expect(late).toBe(completed);
    expect(late.messages.at(-1)).toMatchObject({ text: "", status: "completed" });
  });

  it.each(["completed", "cancelled", "truncated"] as const)(
    "preserves partial text when the turn becomes %s",
    (terminal) => {
      const streamed = update(submitted(), "request-1", { type: "text-delta", text: "部分回答" });
      const finished = update(streamed, "request-1", { type: terminal });

      expect(finished.activeTurn).toBeNull();
      expect(finished.messages.at(-1)).toMatchObject({ text: "部分回答", status: terminal });
    },
  );

  it("stores a business failure without deleting streamed text", () => {
    const streamed = update(submitted(), "request-1", { type: "text-delta", text: "部分回答" });
    const failed = update(streamed, "request-1", {
      type: "failed",
      failure: { code: "model-failed", message: "模型失败", details: {} },
    });

    expect(failed.activeTurn).toBeNull();
    expect(failed.messages.at(-1)).toMatchObject({
      text: "部分回答",
      status: "failed",
      failure: { code: "model-failed", message: "模型失败" },
    });
  });

  it("maps bridge and command failures only onto the current request", () => {
    const state = submitted();
    const stale = conversationReducer(state, {
      type: "turn-command-failed",
      requestId: "old-request",
      failure: { code: "old", message: "old" },
    });
    const failed = conversationReducer(stale, {
      type: "turn-update",
      update: {
        type: "bridge-error",
        requestId: "request-1",
        failure: { code: "connection-closed", message: "连接断开" },
      },
    });

    expect(stale).toBe(state);
    expect(failed.messages.at(-1)).toMatchObject({
      status: "failed",
      failure: { code: "connection-closed", message: "连接断开" },
    });
  });

  it("keeps v2 content blocks in stream order and separates reasoning", () => {
    let state = submitted();
    state = v2(state, {
      type: "turn-started", sessionId: "session-1", requestId: "request-1", turnId: "turn-1",
    });
    state = v2(state, {
      type: "step-started", sessionId: "session-1", requestId: "request-1", turnId: "turn-1",
      stepId: "step-1", messageId: "message-1",
    });
    state = v2(state, {
      type: "content-started", sessionId: "session-1", requestId: "request-1", turnId: "turn-1",
      stepId: "step-1", messageId: "message-1", contentIndex: 0, kind: "reasoning",
    });
    state = v2(state, {
      type: "content-delta", sessionId: "session-1", requestId: "request-1", turnId: "turn-1",
      stepId: "step-1", messageId: "message-1", contentIndex: 0, delta: "thinking",
    });
    state = v2(state, {
      type: "content-started", sessionId: "session-1", requestId: "request-1", turnId: "turn-1",
      stepId: "step-1", messageId: "message-1", contentIndex: 1, kind: "text",
    });
    state = v2(state, {
      type: "content-delta", sessionId: "session-1", requestId: "request-1", turnId: "turn-1",
      stepId: "step-1", messageId: "message-1", contentIndex: 1, delta: "answer",
    });

    const assistant = state.messages.at(-1);
    expect(assistant).toMatchObject({ role: "assistant", text: "answer", turnId: "turn-1" });
    expect(assistant && assistant.role === "assistant" ? assistant.blocks : []).toEqual([
      { id: "request-1:step-1:0", kind: "reasoning", text: "thinking", status: "streaming" },
      { id: "request-1:step-1:1", kind: "text", text: "answer", status: "streaming" },
    ]);
  });

  it("updates a command notice in place by command id", () => {
    const started = conversationReducer(initialConversationState, {
      type: "command-update",
      event: {
        type: "command-started", sessionId: "session-1", commandId: "command-1", name: "hello",
        anchor: { kind: "session" },
      },
    });
    const completed = conversationReducer(started, {
      type: "command-update",
      event: {
        type: "command-completed", sessionId: "session-1", commandId: "command-1", name: "hello",
        anchor: { kind: "session" }, summary: "hello",
      },
    });

    expect(completed.commands).toEqual([{
      id: "command-command-1",
      role: "system",
      commandId: "command-1",
      name: "hello",
      anchor: { kind: "session" },
      status: "succeeded",
      summary: "hello",
      failure: null,
    }]);
    expect(completed.timeline).toEqual([{ kind: "command", id: "command-command-1" }]);
  });

  it("associates tool execution state with its tool call", () => {
    let state = submitted();
    state = v2(state, {
      type: "turn-started", sessionId: "session-1", requestId: "request-1", turnId: "turn-1",
    });
    state = v2(state, {
      type: "content-started", sessionId: "session-1", requestId: "request-1", turnId: "turn-1",
      stepId: "step-1", messageId: "message-1", contentIndex: 0, kind: "tool-call",
      toolCallId: "tool-1", toolName: "read",
    });
    state = v2(state, {
      type: "content-delta", sessionId: "session-1", requestId: "request-1", turnId: "turn-1",
      stepId: "step-1", messageId: "message-1", contentIndex: 0, delta: "{}",
    });
    state = v2(state, {
      type: "tool-started", sessionId: "session-1", requestId: "request-1", turnId: "turn-1",
      stepId: "step-1", messageId: "message-1", contentIndex: 0, toolCallId: "tool-1",
    });
    state = v2(state, {
      type: "tool-result", sessionId: "session-1", requestId: "request-1", turnId: "turn-1",
      stepId: "step-1", messageId: "message-1", contentIndex: 0, toolCallId: "tool-1",
      status: "succeeded", summary: "done", detail: "result",
    });

    expect(state.messages.at(-1)).toMatchObject({
      role: "assistant",
      blocks: [{
        kind: "tool-call", toolCallId: "tool-1", toolName: "read", arguments: "{}",
        status: "succeeded", summary: "done", detail: "result", failure: null,
      }],
    });
  });
});

function submitted(): ConversationState {
  return conversationReducer(initialConversationState, {
    type: "turn-submitted",
    requestId: "request-1",
    userMessageId: "user-1",
    assistantMessageId: "assistant-1",
    text: "你好",
  });
}

function update(
  state: ConversationState,
  requestId: string,
  event: Extract<DesktopAgentTurnUpdate, { readonly type: "event" }>["event"],
): ConversationState {
  return conversationReducer(state, {
    type: "turn-update",
    update: { type: "event", requestId, event },
  });
}

function v2(state: ConversationState, event: AgentTurnV2Event): ConversationState {
  return conversationReducer(state, { type: "agent-event", update: { type: "turn-event", event } });
}
