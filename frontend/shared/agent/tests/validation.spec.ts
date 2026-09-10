import { describe, expect, it } from "vitest";

import { parseDesktopAgentCommandResult, parseDesktopAgentEvent, parseDesktopAgentTurnUpdate } from "../validation.js";

describe("parseDesktopAgentTurnUpdate", () => {
  it("accepts validated Agent events and bridge failures", () => {
    expect(parseDesktopAgentTurnUpdate({
      type: "event",
      requestId: "request-1",
      event: { type: "text-delta", text: "你好" },
    })).toEqual({
      type: "event",
      requestId: "request-1",
      event: { type: "text-delta", text: "你好" },
    });
    expect(parseDesktopAgentTurnUpdate({
      type: "bridge-error",
      requestId: "request-2",
      failure: { code: "connection-closed", message: "closed" },
    }).type).toBe("bridge-error");
  });

  it("rejects extra fields and malformed Agent events", () => {
    expect(() => parseDesktopAgentTurnUpdate({
      type: "event",
      requestId: "request-1",
      event: { type: "completed", extra: true },
    })).toThrow();
    expect(() => parseDesktopAgentTurnUpdate({
      type: "bridge-error",
      requestId: "request-1",
      failure: { code: "bad", message: "bad", stack: "secret" },
    })).toThrow();
  });
});

describe("parseDesktopAgentCommandResult", () => {
  it("accepts only exact command acknowledgements", () => {
    expect(parseDesktopAgentCommandResult({ type: "accepted" })).toEqual({ type: "accepted" });
    expect(parseDesktopAgentCommandResult({
      type: "rejected",
      failure: { code: "turn-in-progress", message: "Agent 正在生成" },
    })).toEqual({
      type: "rejected",
      failure: { code: "turn-in-progress", message: "Agent 正在生成" },
    });
    expect(() => parseDesktopAgentCommandResult({ type: "accepted", extra: true })).toThrow();
  });
});

describe("parseDesktopAgentEvent", () => {
  it("accepts v2 turn and command events", () => {
    expect(parseDesktopAgentEvent({
      type: "turn-event",
      event: {
        type: "turn-started", sessionId: "session-1", requestId: "request-1", turnId: "turn-1",
      },
    })).toEqual({
      type: "turn-event",
      event: {
        type: "turn-started", sessionId: "session-1", requestId: "request-1", turnId: "turn-1",
      },
    });
    expect(parseDesktopAgentEvent({
      type: "command-event",
      event: {
        type: "command-started", sessionId: "session-1", commandId: "command-1", name: "hello",
        anchor: { kind: "session" },
      },
    })).toMatchObject({ type: "command-event", event: { commandId: "command-1" } });
  });

  it("rejects command events on the turn branch", () => {
    expect(() => parseDesktopAgentEvent({
      type: "turn-event",
      event: {
        type: "command-started", sessionId: "session-1", commandId: "command-1", name: "hello",
        anchor: { kind: "session" },
      },
    })).toThrow();
  });
});
