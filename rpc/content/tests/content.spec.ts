import { describe, expect, it } from "vitest";

import {
  CONTENT_DELTA_MAX_CHARS,
  CONTENT_MAX_CHARS,
  CONTENT_MAX_COUNT,
  CONTENT_MAX_EVENTS,
  CONTENT_TURN_MAX_CHARS,
  TOOL_DETAIL_MAX_CHARS,
  agentTurnMethod,
  agentTurnV2Method,
  createTurnOutputValidator,
  parseTurnEvent,
} from "../../index.js";

const input = { sessionId: "s", requestId: "r", text: "hello" };
const turn = { sessionId: "s", requestId: "r", turnId: "t" };
const step = { ...turn, stepId: "step-1", messageId: "message-1" };
const content = { ...step, contentIndex: 0 };
const failure = { code: "tool-failed", message: "Safe failure" };
const result = { ...content, type: "tool-result", toolCallId: "call-1",
  status: "succeeded", summary: "done", detail: "" };

function started() {
  const validator = createTurnOutputValidator(input);
  validator.parse({ ...turn, type: "turn-started" });
  validator.parse({ ...step, type: "step-started" });
  return validator;
}

function toolReady() {
  const validator = started();
  validator.parse({ ...content, type: "content-started", kind: "tool-call",
    toolCallId: "call-1", toolName: "read" });
  validator.parse({ ...content, type: "content-delta", delta: "{}" });
  validator.parse({ ...content, type: "content-completed" });
  return validator;
}

describe("F3 turn stream contract", () => {
  it("retains the F2 method and rejects new events on it", () => {
    expect(agentTurnMethod.name).toBe("agent.turn");
    expect(agentTurnV2Method.name).toBe("agent.turn.v2");
    expect(() => agentTurnMethod.parseOutput({ ...turn, type: "turn-started" })).toThrow();
  });

  it("preserves interleaved content, tool association and step-scoped indexes", () => {
    const validator = started();
    for (const [contentIndex, kind] of [[0, "reasoning"], [1, "text"]] as const) {
      validator.parse({ ...step, contentIndex, type: "content-started", kind });
      validator.parse({ ...step, contentIndex, type: "content-delta", delta: "data" });
      validator.parse({ ...step, contentIndex, type: "content-completed" });
    }
    for (const contentIndex of [2, 3]) {
      const id = String(contentIndex);
      validator.parse({ ...step, contentIndex, type: "content-started",
        kind: "tool-call", toolCallId: id, toolName: "read" });
    }
    for (const contentIndex of [3, 2]) {
      const id = String(contentIndex);
      validator.parse({ ...step, contentIndex, type: "content-delta", delta: "{}" });
      validator.parse({ ...step, contentIndex, type: "content-completed" });
      validator.parse({ ...step, contentIndex, type: "tool-started", toolCallId: id });
    }
    for (const contentIndex of [3, 2]) {
      validator.parse({ ...result, contentIndex, toolCallId: String(contentIndex) });
    }
    validator.parse({ ...step, type: "step-completed" });

    const next = { ...turn, stepId: "step-2", messageId: "message-2" };
    validator.parse({ ...next, type: "step-started" });
    validator.parse({ ...next, contentIndex: 0, type: "content-started", kind: "text" });
    validator.parse({ ...next, contentIndex: 0, type: "content-delta", delta: "answer" });
    validator.parse({ ...next, contentIndex: 0, type: "content-completed" });
    validator.parse({ ...next, type: "step-completed" });
    validator.parse({ ...turn, type: "turn-completed" });
    expect(() => validator.end()).not.toThrow();
    expect(() => validator.parse({ ...turn, type: "turn-completed" })).toThrow();
  });

  it.each(["sessionId", "requestId", "turnId", "stepId", "messageId"])(
    "rejects mismatched %s",
    (key) => {
      const validator = started();
      expect(() => validator.parse({ ...content, type: "content-started",
        kind: "text", [key]: "other" })).toThrow();
      expect(() => validator.end()).toThrow();
    },
  );

  it("binds the first event to a snapshot of input identity", () => {
    expect(() => createTurnOutputValidator(input).parse({
      ...turn, sessionId: "other", type: "turn-started",
    })).toThrow();
    const mutable = { ...input };
    const validator = createTurnOutputValidator(mutable);
    mutable.sessionId = "other";
    expect(() => validator.parse({ ...turn, type: "turn-started" })).not.toThrow();
  });

  it.each(["turn-cancelled", "turn-truncated", "turn-failed"])(
    "preserves open partial content on %s",
    (type) => {
      const validator = started();
      validator.parse({ ...content, type: "content-started", kind: "text" });
      validator.parse({ ...content, type: "content-delta", delta: "partial" });
      validator.parse({ ...turn, type,
        ...(type === "turn-failed" ? { failure } : {}) });
      expect(() => validator.end()).not.toThrow();
      expect(() => validator.parse({ ...content, type: "content-delta", delta: "late" }))
        .toThrow();
    },
  );

  it.each(["failed", "cancelled"])(
    "accepts a tool %s before dispatch without pretending it executed",
    (status) => {
      const validator = toolReady();
      validator.parse({ ...result, status, failure });
      validator.parse({ ...step, type: "step-completed" });
      validator.parse({ ...turn, type: "turn-completed" });
      expect(() => validator.end()).not.toThrow();
    },
  );

  it("rejects invalid tool order, association and duplicate results", () => {
    expect(() => toolReady().parse(result)).toThrow();
    expect(() => toolReady().parse({ ...content, type: "tool-started",
      toolCallId: "wrong" })).toThrow();
    const validator = toolReady();
    validator.parse({ ...content, type: "tool-started", toolCallId: "call-1" });
    validator.parse(result);
    expect(() => validator.parse(result)).toThrow();
    expect(() => toolReady().parse({ ...content, type: "content-delta", delta: "late" }))
      .toThrow();
  });

  it("rejects unfinished lifecycles, duplicate identities and malformed fields", () => {
    expect(() => started().parse({ ...turn, type: "turn-completed" })).toThrow();
    expect(() => toolReady().parse({ ...step, type: "step-completed" })).toThrow();
    expect(() => started().end()).toThrow();
    expect(() => started().parse({ ...step, type: "step-started" })).toThrow();
    const validator = toolReady();
    expect(() => validator.parse({ ...step, contentIndex: 1, type: "content-started",
      kind: "tool-call", toolCallId: "call-1", toolName: "read" })).toThrow();
    for (const candidate of [
      { ...turn, type: "unknown" },
      { ...turn, type: "turn-started", version: 2 },
      { ...turn, type: "turn-started", turnId: "x".repeat(129) },
      { ...content, contentIndex: -1, type: "content-started", kind: "text" },
      { ...content, type: "content-delta", delta: "" },
      { ...content, type: "content-delta", delta: "x".repeat(CONTENT_DELTA_MAX_CHARS + 1) },
      { ...result, detail: "x".repeat(TOOL_DETAIL_MAX_CHARS + 1) },
      { ...result, status: "failed", failure: { ...failure, details: { secret: true } } },
      { ...result, detail: { arbitrary: true } },
    ]) expect(() => parseTurnEvent(candidate)).toThrow();
    expect(parseTurnEvent({ ...result, detail: "x".repeat(TOOL_DETAIL_MAX_CHARS) }))
      .toMatchObject({ status: "succeeded" });
  });

  it("bounds cumulative content and turn text", () => {
    const validator = started();
    validator.parse({ ...content, type: "content-started", kind: "text" });
    for (let n = 0; n < CONTENT_MAX_CHARS / CONTENT_DELTA_MAX_CHARS; n++) {
      validator.parse({ ...content, type: "content-delta",
        delta: "x".repeat(CONTENT_DELTA_MAX_CHARS) });
    }
    expect(() => validator.parse({ ...content, type: "content-delta", delta: "x" }))
      .toThrow("Content text limit");

    const total = started();
    for (let index = 0; index < CONTENT_TURN_MAX_CHARS / CONTENT_MAX_CHARS; index++) {
      const scope = { ...step, contentIndex: index };
      total.parse({ ...scope, type: "content-started", kind: "text" });
      for (let n = 0; n < CONTENT_MAX_CHARS / CONTENT_DELTA_MAX_CHARS; n++) {
        total.parse({ ...scope, type: "content-delta",
          delta: "x".repeat(CONTENT_DELTA_MAX_CHARS) });
      }
      total.parse({ ...scope, type: "content-completed" });
    }
    const overflow = { ...step, contentIndex: 4 };
    total.parse({ ...overflow, type: "content-started", kind: "text" });
    expect(() => total.parse({ ...overflow, type: "content-delta", delta: "x" }))
      .toThrow("Turn content limit");
  });

  it("bounds retained content identities and event count without limiting steps", () => {
    const validator = started();
    for (let contentIndex = 0; contentIndex < CONTENT_MAX_COUNT; contentIndex++) {
      validator.parse({ ...step, contentIndex, type: "content-started", kind: "text" });
    }
    expect(() => validator.parse({ ...step, contentIndex: CONTENT_MAX_COUNT,
      type: "content-started", kind: "text" })).toThrow("excessive content");

    const steps = createTurnOutputValidator(input);
    steps.parse({ ...turn, type: "turn-started" });
    for (let n = 0; n < 129; n++) {
      const scope = { ...turn, stepId: String(n), messageId: String(n) };
      steps.parse({ ...scope, type: "step-started" });
      steps.parse({ ...scope, type: "step-completed" });
    }
    steps.parse({ ...turn, type: "turn-completed" });
    expect(() => steps.end()).not.toThrow();

    const events = started();
    events.parse({ ...content, type: "content-started", kind: "text" });
    for (let n = 3; n < CONTENT_MAX_EVENTS; n++) {
      events.parse({ ...content, type: "content-delta", delta: "x" });
    }
    expect(() => events.parse({ ...content, type: "content-completed" }))
      .toThrow("event limit");
  });

  it("bounds malicious empty Steps including Turn lifecycle events", () => {
    const validator = createTurnOutputValidator(input);
    validator.parse({ ...turn, type: "turn-started" });
    for (let n = 0; n < (CONTENT_MAX_EVENTS - 2) / 2; n++) {
      const scope = { ...turn, stepId: String(n), messageId: String(n) };
      validator.parse({ ...scope, type: "step-started" });
      validator.parse({ ...scope, type: "step-completed" });
    }
    validator.parse({ ...turn, stepId: "overflow", messageId: "overflow", type: "step-started" });
    expect(() => validator.parse({ ...turn, stepId: "overflow", messageId: "overflow",
      type: "step-completed" })).toThrow("Turn event limit");
    expect(() => validator.parse({ ...turn, type: "turn-cancelled" })).toThrow("closed");
    expect(() => validator.end()).toThrow();
  });
});
