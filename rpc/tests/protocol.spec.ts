import { describe, expect, it } from "vitest";
import {
  NdjsonDecoder,
  RPC_PROTOCOL_VERSION,
  encodeNdjson,
  createAgentTurnOutputValidator,
  parseAgentTurnEvent,
  parseAgentTurnInput,
  parseRpcClientFrame,
  parseRpcServerFrame,
} from "../index.js";

describe("Stream RPC protocol", () => {
  it("accepts exact versioned stream frames", () => {
    expect(parseRpcClientFrame({
      version: RPC_PROTOCOL_VERSION,
      type: "open",
      id: "rpc-1",
      method: "agent.turn",
      params: { text: "hello" },
    })).toMatchObject({ type: "open", id: "rpc-1", method: "agent.turn" });

    expect(parseRpcServerFrame({
      version: RPC_PROTOCOL_VERSION,
      type: "item",
      id: "rpc-1",
      value: { type: "completed" },
    })).toMatchObject({ type: "item", id: "rpc-1" });
  });

  it("rejects unknown versions, extra keys and unsafe JSON", () => {
    expect(() => parseRpcClientFrame({
      version: 2,
      type: "cancel",
      id: "rpc-1",
    })).toThrow("Unsupported RPC version");
    expect(() => parseRpcClientFrame({
      version: 1,
      type: "cancel",
      id: "rpc-1",
      extra: true,
    })).toThrow("malformed");
    expect(() => parseRpcServerFrame({
      version: 1,
      type: "item",
      id: "rpc-1",
      value: Number.NaN,
    })).toThrow("JSON-safe");
  });

  it("validates agent input and every output variant", () => {
    expect(parseAgentTurnInput({
      sessionId: "session-1",
      requestId: "request-1",
      text: "你好",
    }).text).toBe("你好");
    expect(parseAgentTurnEvent({ type: "started", turnId: "turn-1" })).toEqual({
      type: "started",
      turnId: "turn-1",
    });
    expect(parseAgentTurnEvent({ type: "text-delta", text: "你" })).toEqual({
      type: "text-delta",
      text: "你",
    });
    expect(parseAgentTurnEvent({ type: "completed" })).toEqual({ type: "completed" });
    expect(() => parseAgentTurnEvent({ type: "text-delta", text: "" })).toThrow("delta text");
  });

  it("requires started, one terminal event, and no events after terminal", () => {
    const complete = createAgentTurnOutputValidator();
    complete.parse({ type: "started", turnId: "turn-1" });
    complete.parse({ type: "text-delta", text: "完成" });
    complete.parse({ type: "completed" });
    expect(() => complete.end()).not.toThrow();
    expect(() => complete.parse({ type: "text-delta", text: "迟到" })).toThrow("order");

    const incomplete = createAgentTurnOutputValidator();
    incomplete.parse({ type: "started", turnId: "turn-2" });
    expect(() => incomplete.end()).toThrow("without a business terminal");
  });

  it("decodes split and coalesced NDJSON chunks", () => {
    const decoder = new NdjsonDecoder(parseRpcClientFrame);
    const first = encodeNdjson({ version: 1, type: "cancel", id: "one" });
    const second = encodeNdjson({ version: 1, type: "cancel", id: "two" });
    const bytes = new TextEncoder().encode(first + second);
    expect(decoder.push(bytes.slice(0, 7))).toEqual([]);
    expect(decoder.push(bytes.slice(7))).toEqual([
      { version: 1, type: "cancel", id: "one" },
      { version: 1, type: "cancel", id: "two" },
    ]);
    expect(decoder.finish()).toEqual([]);
  });
});
