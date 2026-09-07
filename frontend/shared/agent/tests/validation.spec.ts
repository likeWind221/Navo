import { describe, expect, it } from "vitest";

import { parseDesktopAgentCommandResult, parseDesktopAgentTurnUpdate } from "../validation.js";

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
