import { DISPLAY_SUMMARY_MAX_CHARS, parseDisplayFailure } from "../failure.js";
import type { CommandEvent, TurnEvent } from "../content.js";
import { CONTENT_DELTA_MAX_CHARS, TOOL_DETAIL_MAX_CHARS } from "../content.js";
import { RpcError } from "../errors.js";
import { exactKeys, requireBoundedString, requireRecord } from "../validation.js";

/** Parse one exact event; lifecycle and identity association belong to the stream validator. */
export function parseTurnEvent(value: unknown): TurnEvent {
  const event = requireRecord(value, "turn event");
  if (isCommandType(event.type)) return parseCommandEventRecord(event);
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
  keys.push("contentIndex");
  const content = { ...step, contentIndex: requireContentIndex(event.contentIndex) };
  if (type === "content-started") {
    if (event.kind === "text" || event.kind === "reasoning") {
      requireKeys(event, [...keys, "kind"]);
      return { ...content, type, kind: event.kind };
    }
    if (event.kind === "tool-call") {
      requireKeys(event, [...keys, "kind", "toolCallId", "toolName"]);
      return { ...content, type, kind: event.kind,
        toolCallId: requireBoundedString(event.toolCallId, "toolCallId", 128),
        toolName: requireBoundedString(event.toolName, "toolName", 128) };
    }
  }
  if (type === "content-delta") {
    requireKeys(event, [...keys, "delta"]);
    return { ...content, type, delta: requireBoundedString(event.delta, "delta", CONTENT_DELTA_MAX_CHARS) };
  }
  if (type === "content-completed") {
    requireKeys(event, keys);
    return { ...content, type };
  }
  if (type === "tool-started" || type === "tool-result") {
    keys.push("toolCallId");
    const tool = { ...content, toolCallId: requireBoundedString(event.toolCallId, "toolCallId", 128) };
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

export function parseCommandEvent(value: unknown): CommandEvent {
  const event = requireRecord(value, "command event");
  if (!isCommandType(event.type)) throw new RpcError("invalid-frame", "Unknown command event variant");
  return parseCommandEventRecord(event);
}

function parseCommandEventRecord(event: Record<string, unknown>): CommandEvent {
  const keys = ["type", "sessionId", "commandId", "name", "anchor"];
  const name = requireBoundedString(event.name, "command name", 64);
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new RpcError("invalid-frame", "Invalid command name");
  const scope = {
    sessionId: requireBoundedString(event.sessionId, "sessionId", 128),
    commandId: requireBoundedString(event.commandId, "commandId", 128),
    name,
    anchor: parseCommandAnchor(event.anchor),
  };
  if (event.type === "command-started") {
    requireKeys(event, keys);
    return { ...scope, type: event.type };
  }
  if (event.type === "command-completed") {
    requireKeys(event, [...keys, "summary"]);
    return { ...scope, type: event.type,
      summary: requireBoundedString(event.summary, "command summary", DISPLAY_SUMMARY_MAX_CHARS) };
  }
  if (event.type === "command-failed") {
    requireKeys(event, [...keys, "failure"]);
    return { ...scope, type: event.type, failure: parseDisplayFailure(event.failure) };
  }
  requireKeys(event, keys);
  return { ...scope, type: "command-cancelled" };
}

function parseCommandAnchor(value: unknown): CommandEvent["anchor"] {
  const anchor = requireRecord(value, "command anchor");
  if (anchor.kind === "session") {
    requireKeys(anchor, ["kind"]);
    return { kind: "session" };
  }
  if (anchor.kind === "turn") {
    requireKeys(anchor, ["kind", "turnId"]);
    return { kind: "turn", turnId: requireBoundedString(anchor.turnId, "anchor turnId", 128) };
  }
  throw new RpcError("invalid-frame", "Malformed command anchor");
}

function isCommandType(value: unknown): value is CommandEvent["type"] {
  return value === "command-started" || value === "command-completed"
    || value === "command-failed" || value === "command-cancelled";
}

function requireKeys(value: Record<string, unknown>, keys: readonly string[]): void {
  if (!exactKeys(value, keys)) throw new RpcError("invalid-frame", "Malformed event fields");
}

function requireContentIndex(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new RpcError("invalid-frame", "contentIndex must be a non-negative safe integer");
  }
  return value as number;
}
