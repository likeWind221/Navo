import { DISPLAY_SUMMARY_MAX_CHARS, parseDisplayFailure } from "../failure.js";
import type { AssistantEvent } from "../content.js";
import { CONTENT_DELTA_MAX_CHARS, TOOL_DETAIL_MAX_CHARS } from "../content.js";
import { RpcError } from "../errors.js";
import { exactKeys, requireBoundedString, requireRecord } from "../validation.js";

/** Parse one exact event; lifecycle and identity association belong to the stream validator. */
export function parseAssistantEvent(value: unknown): AssistantEvent {
  const event = requireRecord(value, "assistant event");
  const keys = ["type", "sessionId", "requestId", "turnId"];
  const scope = {
    sessionId: requireBoundedString(event.sessionId, "sessionId", 128),
    requestId: requireBoundedString(event.requestId, "requestId", 128),
    turnId: requireBoundedString(event.turnId, "turnId", 128),
  };
  const type = event.type;
  if (type === "turn-started" || type === "turn-completed" || type === "turn-cancelled" || type === "turn-truncated") {
    requireKeys(event, keys);
    return { ...scope, type };
  }
  if (type === "turn-failed") {
    requireKeys(event, [...keys, "failure"]);
    return { ...scope, type, failure: parseDisplayFailure(event.failure) };
  }
  keys.push("stepId", "messageId");
  const step = {
    ...scope,
    stepId: requireBoundedString(event.stepId, "stepId", 128),
    messageId: requireBoundedString(event.messageId, "messageId", 128),
  };
  if (type === "step-started" || type === "step-completed") {
    requireKeys(event, keys);
    return { ...step, type };
  }
  keys.push("blockId");
  const block = { ...step, blockId: requireBoundedString(event.blockId, "blockId", 128) };
  if (type === "block-started") {
    if (event.kind === "text" || event.kind === "reasoning") {
      requireKeys(event, [...keys, "kind"]);
      return { ...block, type, kind: event.kind };
    }
    if (event.kind === "tool-call") {
      requireKeys(event, [...keys, "kind", "toolCallId", "toolName"]);
      return { ...block, type, kind: event.kind,
        toolCallId: requireBoundedString(event.toolCallId, "toolCallId", 128),
        toolName: requireBoundedString(event.toolName, "toolName", 128) };
    }
  }
  if (type === "block-delta") {
    requireKeys(event, [...keys, "delta"]);
    return { ...block, type, delta: requireBoundedString(event.delta, "delta", CONTENT_DELTA_MAX_CHARS) };
  }
  if (type === "block-completed") {
    requireKeys(event, keys);
    return { ...block, type };
  }
  if (type === "tool-started" || type === "tool-result") {
    keys.push("toolCallId");
    const tool = { ...block, toolCallId: requireBoundedString(event.toolCallId, "toolCallId", 128) };
    if (type === "tool-started") {
      requireKeys(event, keys);
      return { ...tool, type };
    }
    const summary = requireBoundedString(event.summary, "summary", DISPLAY_SUMMARY_MAX_CHARS);
    if (typeof event.detail !== "string" || event.detail.length > TOOL_DETAIL_MAX_CHARS) {
      throw new RpcError("invalid-frame", "Tool detail exceeds its string limit");
    }
    const detail = event.detail;
    if (event.status === "succeeded") {
      requireKeys(event, [...keys, "status", "summary", "detail"]);
      return { ...tool, type, status: event.status, summary, detail };
    }
    if (event.status === "failed" || event.status === "cancelled") {
      requireKeys(event, [...keys, "status", "summary", "detail", "failure"]);
      return { ...tool, type, status: event.status, summary, detail, failure: parseDisplayFailure(event.failure) };
    }
  }
  throw new RpcError("invalid-frame", "Unknown assistant event variant");
}

function requireKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (!exactKeys(value, keys)) throw new RpcError("invalid-frame", "Malformed event fields");
}
