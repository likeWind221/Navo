import { describe, expect, it } from "vitest";
import { CONTENT_BLOCK_MAX_CHARS, CONTENT_DELTA_MAX_CHARS, CONTENT_MAX_BLOCKS, CONTENT_MAX_EVENTS,
  CONTENT_MAX_STEPS, CONTENT_TURN_MAX_CHARS, TOOL_DETAIL_MAX_CHARS, createAssistantOutputValidator,
  parseAssistantEvent, assistantTurnMethod, agentTurnMethod } from "../../index.js";

const input = { sessionId: "s", requestId: "r", text: "hello" };
const turn = { sessionId: "s", requestId: "r", turnId: "t" };
const step = { ...turn, stepId: "step-1", messageId: "message-1" };
const block = { ...step, blockId: "block-1" };
const failure = { code: "tool-failed", message: "Safe failure" };
const result = { ...block, type: "tool-result", toolCallId: "call-1", status: "succeeded", summary: "done", detail: "" };

function started() {
  const validator = createAssistantOutputValidator(input);
  validator.parse({ ...turn, type: "turn-started" });
  validator.parse({ ...step, type: "step-started" });
  return validator;
}
function toolReady() {
  const validator = started();
  validator.parse({ ...block, type: "block-started", kind: "tool-call", toolCallId: "call-1", toolName: "read" });
  validator.parse({ ...block, type: "block-delta", delta: "{}" });
  validator.parse({ ...block, type: "block-completed" });
  return validator;
}

describe("F3 assistant contract", () => {
  it("retains the F2 method and rejects new events on it", () => {
    expect(agentTurnMethod.name).toBe("agent.turn");
    expect(assistantTurnMethod.name).toBe("agent.turn.v2");
    expect(() => agentTurnMethod.parseOutput({ ...turn, type: "turn-started" })).toThrow();
  });

  it("preserves ordered blocks, interleaved arguments and multiple model steps", () => {
    const v = started();
    for (const [blockId, kind] of [["reason", "reasoning"], ["text", "text"]]) {
      v.parse({ ...step, blockId, type: "block-started", kind });
      v.parse({ ...step, blockId, type: "block-delta", delta: "你好" });
      v.parse({ ...step, blockId, type: "block-completed" });
    }
    for (const id of ["a", "b"]) v.parse({ ...step, blockId: id, type: "block-started", kind: "tool-call", toolCallId: id, toolName: "read" });
    for (const id of ["b", "a"]) {
      v.parse({ ...step, blockId: id, type: "block-delta", delta: "{}" });
      v.parse({ ...step, blockId: id, type: "block-completed" });
      v.parse({ ...step, blockId: id, type: "tool-started", toolCallId: id });
    }
    for (const id of ["b", "a"]) v.parse({ ...result, blockId: id, toolCallId: id });
    v.parse({ ...step, type: "step-completed" });
    const next = { ...turn, stepId: "step-2", messageId: "message-2", blockId: "answer" };
    v.parse({ ...turn, stepId: next.stepId, messageId: next.messageId, type: "step-started" });
    v.parse({ ...next, type: "block-started", kind: "text" });
    v.parse({ ...next, type: "block-delta", delta: "answer" });
    v.parse({ ...next, type: "block-completed" });
    v.parse({ ...turn, stepId: next.stepId, messageId: next.messageId, type: "step-completed" });
    v.parse({ ...turn, type: "turn-completed" });
    expect(() => v.end()).not.toThrow();
    expect(() => v.parse({ ...turn, type: "turn-completed" })).toThrow();
  });

  it.each(["sessionId", "requestId", "turnId", "stepId", "messageId"])("rejects mismatched %s", key => {
    const v = started();
    expect(() => v.parse({ ...block, type: "block-started", kind: "text", [key]: "other" })).toThrow();
    expect(() => v.end()).toThrow();
  });

  it("binds the first event to input and snapshots input identity", () => {
    expect(() => createAssistantOutputValidator(input).parse({ ...turn, sessionId: "other", type: "turn-started" })).toThrow();
    const mutable = { ...input };
    const v = createAssistantOutputValidator(mutable);
    mutable.sessionId = "other";
    expect(() => v.parse({ ...turn, type: "turn-started" })).not.toThrow();
  });

  it.each(["turn-cancelled", "turn-truncated", "turn-failed"])("preserves an open partial block on %s", type => {
    const v = started();
    v.parse({ ...block, type: "block-started", kind: "text" });
    v.parse({ ...block, type: "block-delta", delta: "partial" });
    v.parse({ ...turn, type, ...(type === "turn-failed" ? { failure } : {}) });
    expect(() => v.end()).not.toThrow();
    expect(() => v.parse({ ...block, type: "block-delta", delta: "late" })).toThrow();
  });

  it.each(["failed", "cancelled"])("accepts a tool %s before dispatch without pretending it executed", status => {
    const v = toolReady();
    v.parse({ ...result, status, failure });
    v.parse({ ...step, type: "step-completed" });
    v.parse({ ...turn, type: "turn-completed" });
    expect(() => v.end()).not.toThrow();
  });

  it("rejects early success, wrong tool association and duplicate results", () => {
    expect(() => toolReady().parse(result)).toThrow();
    expect(() => toolReady().parse({ ...block, type: "tool-started", toolCallId: "wrong" })).toThrow();
    const v = toolReady();
    v.parse({ ...block, type: "tool-started", toolCallId: "call-1" });
    v.parse(result);
    expect(() => v.parse(result)).toThrow();
  });

  it("rejects execution during argument generation and reuse of closed blocks", () => {
    const v = started();
    v.parse({ ...block, type: "block-started", kind: "tool-call", toolCallId: "call-1", toolName: "read" });
    expect(() => v.parse({ ...block, type: "tool-started", toolCallId: "call-1" })).toThrow();
    expect(() => toolReady().parse({ ...block, type: "block-delta", delta: "late" })).toThrow();
  });

  it("rejects unfinished steps, missing terminals and duplicate identities", () => {
    expect(() => started().parse({ ...turn, type: "turn-completed" })).toThrow();
    expect(() => toolReady().parse({ ...step, type: "step-completed" })).toThrow();
    expect(() => started().end()).toThrow();
    expect(() => started().parse({ ...step, type: "step-started" })).toThrow();
    const v = toolReady();
    expect(() => v.parse({ ...step, blockId: "other", type: "block-started", kind: "tool-call", toolCallId: "call-1", toolName: "read" })).toThrow();
  });

  it("rejects malformed fields, private failure details and oversized values", () => {
    for (const candidate of [
      { ...turn, type: "unknown" },
      { ...turn, type: "turn-started", version: 2 },
      { ...turn, type: "turn-started", turnId: "x".repeat(129) },
      { ...block, type: "block-delta", delta: "" },
      { ...block, type: "block-delta", delta: "x".repeat(CONTENT_DELTA_MAX_CHARS + 1) },
      { ...result, detail: "x".repeat(TOOL_DETAIL_MAX_CHARS + 1) },
      { ...result, status: "failed", failure: { ...failure, details: { secret: true } } },
      { ...result, detail: { arbitrary: true } },
    ]) expect(() => parseAssistantEvent(candidate)).toThrow();
    expect(parseAssistantEvent({ ...result, detail: "x".repeat(TOOL_DETAIL_MAX_CHARS) })).toMatchObject({ status: "succeeded" });
  });

  it("bounds cumulative block and turn content", () => {
    const v = started();
    v.parse({ ...block, type: "block-started", kind: "text" });
    for (let n = 0; n < CONTENT_BLOCK_MAX_CHARS / CONTENT_DELTA_MAX_CHARS; n++) {
      v.parse({ ...block, type: "block-delta", delta: "x".repeat(CONTENT_DELTA_MAX_CHARS) });
    }
    expect(() => v.parse({ ...block, type: "block-delta", delta: "x" })).toThrow("Block text limit");
    const total = started();
    for (let b = 0; b < CONTENT_TURN_MAX_CHARS / CONTENT_BLOCK_MAX_CHARS; b++) {
      const scope = { ...block, blockId: String(b) };
      total.parse({ ...scope, type: "block-started", kind: "text" });
      for (let n = 0; n < CONTENT_BLOCK_MAX_CHARS / CONTENT_DELTA_MAX_CHARS; n++) total.parse({ ...scope, type: "block-delta", delta: "x".repeat(CONTENT_DELTA_MAX_CHARS) });
      total.parse({ ...scope, type: "block-completed" });
    }
    total.parse({ ...block, type: "block-started", kind: "text" });
    expect(() => total.parse({ ...block, type: "block-delta", delta: "x" })).toThrow("Turn content limit");
  });

  it("bounds retained identities and event count", () => {
    const v = started();
    for (let n = 0; n < CONTENT_MAX_BLOCKS; n++) v.parse({ ...block, blockId: String(n), type: "block-started", kind: "text" });
    expect(() => v.parse({ ...block, type: "block-started", kind: "text" })).toThrow("excessive block");
    const steps = createAssistantOutputValidator(input);
    steps.parse({ ...turn, type: "turn-started" });
    for (let n = 0; n < CONTENT_MAX_STEPS; n++) {
      const scope = { ...turn, stepId: String(n), messageId: String(n) };
      steps.parse({ ...scope, type: "step-started" });
      steps.parse({ ...scope, type: "step-completed" });
    }
    expect(() => steps.parse({ ...step, type: "step-started" })).toThrow("excessive step");
    const events = started();
    events.parse({ ...block, type: "block-started", kind: "text" });
    for (let n = 3; n < CONTENT_MAX_EVENTS; n++) events.parse({ ...block, type: "block-delta", delta: "x" });
    expect(() => events.parse({ ...block, type: "block-completed" })).toThrow("event limit");
  });
});
