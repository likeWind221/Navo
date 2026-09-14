import { describe, expect, it } from "vitest";

import type { DesktopAgentTurnUpdate } from "../../../../../shared/agent.js";
import type { AgentTurnV2Event } from "../../../../../../rpc/content.js";
import {
  conversationReducer,
  initialConversationState,
} from "../../conversation.js";
import type { ConversationState } from "../../conversation.js";

const NOW = 1_700_000_000_000;

describe("conversationReducer", () => {
  it("adds the user message and assistant placeholder atomically", () => {
    const state = submitted();

    expect(state.messages).toEqual([
      { id: "user-1", role: "user", text: "你好" },
      { id: "assistant-1", role: "assistant", text: "", status: "waiting", failure: null, startedAt: NOW, endedAt: null },
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
    }, NOW);

    expect(duplicate).toBe(state);
  });

  it("records the elapsed time when the turn reaches a terminal state", () => {
    const started = v2(submitted(), {
      type: "turn-started", sessionId: "session-1", requestId: "request-1", turnId: "turn-1",
    });
    const finished = conversationReducer(started, {
      type: "agent-event",
      update: {
        type: "turn-event",
        event: {
          type: "turn-completed", sessionId: "session-1", requestId: "request-1", turnId: "turn-1",
        },
      },
    }, NOW + 12_000);

    expect(finished.messages.at(-1)).toMatchObject({ startedAt: NOW, endedAt: NOW + 12_000 });
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
    }, NOW);
    const failed = conversationReducer(stale, {
      type: "turn-update",
      update: {
        type: "bridge-error",
        requestId: "request-1",
        failure: { code: "connection-closed", message: "连接断开" },
      },
    }, NOW);

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
    }, NOW);
    const completed = conversationReducer(started, {
      type: "command-update",
      event: {
        type: "command-completed", sessionId: "session-1", commandId: "command-1", name: "hello",
        anchor: { kind: "session" }, summary: "hello",
      },
    }, NOW);

    expect(completed.commands).toEqual([{
      id: "command-command-1",
      startedAt: NOW,
      endedAt: NOW,
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
  it("measures command duration from first start and freezes on transport failure", () => {
    const event = { type: "command-started" as const, sessionId: "s", commandId: "c", name: "hello", anchor: { kind: "session" as const } };
    let state = conversationReducer(initialConversationState, { type: "command-update", event }, NOW);
    state = conversationReducer(state, { type: "command-update", event }, NOW + 1_000);
    state = conversationReducer(state, { type: "agent-event", update: {
      type: "command-error", commandId: "c", name: "hello", failure: { code: "closed", message: "closed" },
    } }, NOW + 2_000);
    expect(state.commands[0]).toMatchObject({ startedAt: NOW, endedAt: NOW + 2_000, status: "failed" });
    expect(conversationReducer(state, { type: "command-update", event }, NOW + 5_000)).toBe(state);
  });

  it.each(["turn-cancelled", "turn-failed"] as const)("freezes running tools on %s without a tool result", (type) => {
    const scope = { sessionId: "session-1", requestId: "request-1", turnId: "turn-1" };
    const content = { ...scope, stepId: "step-1", messageId: "message-1", contentIndex: 0, toolCallId: "tool-1" };
    let state = v2(submitted(), { ...scope, type: "turn-started" });
    state = v2(state, { ...content, type: "content-started", kind: "tool-call", toolName: "shell" });
    const pending = state.messages.at(-1);
    expect(pending).toMatchObject({ blocks: [{ startedAt: null, endedAt: null, status: "pending" }] });
    state = v2(state, { ...content, type: "tool-started" });
    const event: AgentTurnV2Event = type === "turn-failed"
      ? { ...scope, type, failure: { code: "model", message: "failure" } }
      : { ...scope, type };
    state = conversationReducer(state, { type: "agent-event", update: { type: "turn-event", event } }, NOW + 3_000);
    expect(state.messages.at(-1)).toMatchObject({ blocks: [{
      startedAt: NOW, endedAt: NOW + 3_000, status: type === "turn-failed" ? "failed" : "cancelled",
    }] });
  });

});

function submitted(): ConversationState {
  return conversationReducer(initialConversationState, {
    type: "turn-submitted",
    requestId: "request-1",
    userMessageId: "user-1",
    assistantMessageId: "assistant-1",
    text: "你好",
  }, NOW);
}

function update(
  state: ConversationState,
  requestId: string,
  event: Extract<DesktopAgentTurnUpdate, { readonly type: "event" }>["event"],
): ConversationState {
  return conversationReducer(state, {
    type: "turn-update",
    update: { type: "event", requestId, event },
  }, NOW);
}

function v2(state: ConversationState, event: AgentTurnV2Event): ConversationState {
  return conversationReducer(state, { type: "agent-event", update: { type: "turn-event", event } }, NOW);
}
