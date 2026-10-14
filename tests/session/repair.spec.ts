import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import {
  createMessageId,
  createSessionId,
  createStepId,
  createToolCallId,
  createTurnId,
} from "../../src/brand/ids.js";
import {
  interruptedTurnClosers,
  TOOL_NOT_STARTED,
  TOOL_OUTCOME_UNKNOWN,
  TURN_INTERRUPTED,
} from "../../src/session/repair.js";
import { SessionStore } from "../../src/session/store.js";

const sessionId = createSessionId("repair-session");
const turnId = createTurnId("repair-turn");
const stepId = createStepId("repair-step");
const ctx = new Context();
await ctx.plugin(SessionStore);

afterEach(() => { ctx.sessions.restore(sessionId, []); });

describe("interruptedTurnClosers", () => {
  it("closes a Turn that stopped while waiting for a model message", () => {
    ctx.sessions.append({ type: "turn-started", sessionId, data: { turnId } });
    ctx.sessions.append({ type: "step-started", sessionId, data: { turnId, stepId } });
    ctx.sessions.append({ type: "llm-requested", sessionId,
      data: { turnId, stepId, provider: "mock", model: "test", messages: [] } });
    const history = ctx.sessions.getEvents(sessionId);

    const closers = interruptedTurnClosers(sessionId, history);

    expect(closers.map(event => event.type)).toEqual(["error", "step-ended", "turn-ended"]);
    expect(closers[0]).toMatchObject({ data: { source: "runtime", failure: { code: TURN_INTERRUPTED } } });
    expect(closers[1]).toMatchObject({ data: { turnId, stepId, status: "failed" } });
    expect(closers[2]).toMatchObject({ data: { turnId, status: "failed" } });
    expect(closers.every(event => event.timestamp === history.at(-1)?.timestamp)).toBe(true);
    expect(interruptedTurnClosers(sessionId, history)).toEqual(closers);
    expect(interruptedTurnClosers(sessionId, [...history, ...closers])).toEqual([]);
  });

  it("supplies distinct error results for unstarted and unknown tool outcomes", () => {
    const notStarted = createToolCallId("not-started");
    const unknown = createToolCallId("outcome-unknown");
    ctx.sessions.append({ type: "turn-started", sessionId, data: { turnId } });
    ctx.sessions.append({ type: "step-started", sessionId, data: { turnId, stepId } });
    ctx.sessions.append({ type: "assistant-message", sessionId, data: {
      turnId, stepId, finishReason: { kind: "tool-calls" },
      message: { id: createMessageId("assistant"), role: "assistant", content: [
        { type: "tool-call", id: notStarted, name: "read", arguments: "{}" },
        { type: "tool-call", id: unknown, name: "write", arguments: "{}" },
      ] },
    } });
    ctx.sessions.append({ type: "tool-call-requested", sessionId, data: {
      turnId, stepId, toolCall: { type: "tool-call", id: unknown, name: "write", arguments: "{}" },
    } });

    const closers = interruptedTurnClosers(sessionId, ctx.sessions.getEvents(sessionId));
    const toolResults = closers.filter(event => event.type === "tool-call-result");
    const errors = closers.filter(event => event.type === "error");

    expect(toolResults.map(event => event.data.message.content[0].toolCallId)).toEqual([notStarted, unknown]);
    expect(toolResults.every(event => event.data.message.content[0].isError)).toBe(true);
    expect(errors.map(event => event.data.failure.code)).toEqual([
      TOOL_NOT_STARTED,
      TOOL_OUTCOME_UNKNOWN,
      TURN_INTERRUPTED,
    ]);
    expect(closers.map(event => event.sequence)).toEqual(
      closers.map((_, index) => ctx.sessions.getEvents(sessionId).length + index + 1),
    );
  });

  it("does nothing for an empty or already closed log", () => {
    expect(interruptedTurnClosers(sessionId, [])).toEqual([]);
    ctx.sessions.append({ type: "turn-started", sessionId, data: { turnId } });
    ctx.sessions.append({ type: "turn-ended", sessionId, data: { turnId, status: "completed" } });
    expect(interruptedTurnClosers(sessionId, ctx.sessions.getEvents(sessionId))).toEqual([]);
  });
});
