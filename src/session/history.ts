import type { SessionId } from "../brand/ids.js";
import { SessionError } from "./errors.js";
import { applySurface, createSurface } from "./surface.js";
import type { SessionEvent } from "./types.js";

export function parseSessionHistory(sessionId: SessionId, history: readonly unknown[]): readonly SessionEvent[] {
  const surface = createSurface();
  const ids = new Set<string>();
  const events = history.map((raw, index) => {
    const event = parseSessionEvent(sessionId, raw, index + 1);
    if (ids.has(event.id)) throw invalid(index + 1, "duplicate event ID");
    ids.add(event.id);
    try {
      applySurface(surface, event);
    } catch {
      throw invalid(index + 1, "invalid surface replacement");
    }
    return event;
  });
  return Object.freeze(events);
}

export function parseSessionEvent(sessionId: SessionId, raw: unknown, sequence: number): SessionEvent {
  if (!record(raw) || !json(raw) || !text(raw.id) || raw.sessionId !== sessionId
      || raw.sequence !== sequence || !Number.isSafeInteger(sequence) || sequence < 1
      || typeof raw.timestamp !== "string" || Number.isNaN(Date.parse(raw.timestamp))
      || !record(raw.data) || !payload(raw.type, raw.data) || !surfaceOp(raw.surfaceOp)) {
    throw invalid(sequence, "invalid event envelope or data");
  }
  if (raw.surfaceOp !== undefined && !oneOf(raw.type, ["user-message", "assistant-message", "tool-call-result", "compaction-checkpoint"])) {
    throw invalid(sequence, "log-only event has a surface operation");
  }
  return deepFreeze(structuredClone(raw)) as unknown as SessionEvent;
}

function payload(type: unknown, data: Record<string, unknown>): boolean {
  if (type === "user-message") return message(data.message, "user");
  if (type === "context-observed") {
    return Array.isArray(data.facts) && data.facts.every(fact => record(fact)
      && text(fact.kind) && text(fact.id) && typeof fact.label === "string"
      && optional(fact.state, value => typeof value === "string"));
  }
  if (type === "compaction-started") {
    return text(data.turnId) && text(data.compactionId) && data.trigger === "pressure"
      && integer(data.coveredStart) && integer(data.coveredEnd)
      && (data.coveredStart as number) > 0 && (data.coveredEnd as number) >= (data.coveredStart as number);
  }
  if (type === "compaction-checkpoint") {
    return text(data.turnId) && text(data.compactionId) && message(data.message, "user")
      && integer(data.coveredStart) && integer(data.coveredEnd)
      && (data.coveredStart as number) > 0 && (data.coveredEnd as number) >= (data.coveredStart as number)
      && data.summaryVersion === 1;
  }
  if (type === "compaction-ended") {
    return text(data.turnId) && text(data.compactionId)
      && oneOf(data.status, ["completed", "failed", "cancelled", "interrupted"])
      && optional(data.beforeTokens, integer) && optional(data.afterTokens, integer)
      && optional(data.summaryTokens, integer) && optional(data.provider, text)
      && optional(data.model, text) && optional(data.usage, usage)
      && optional(data.failure, value => record(value) && text(value.code) && typeof value.message === "string");
  }
  if (!text(data.turnId)) return false;
  if (type === "turn-started") return true;
  if (type === "turn-ended") return status(data.status, false);
  if (type === "error") {
    return optional(data.stepId, text) && optional(data.toolCallId, text)
      && oneOf(data.source, ["llm", "tool", "runtime"]) && failure(data.failure);
  }
  if (!text(data.stepId)) return false;
  switch (type) {
    case "step-started": return true;
    case "step-ended": return status(data.status, true);
    case "llm-requested":
      return text(data.provider) && text(data.model)
        && Array.isArray(data.messages) && data.messages.every(value => message(value))
        && optional(data.tools, value => Array.isArray(value) && value.every(tool => record(tool)
          && text(tool.name) && record(tool.parameters)
          && optional(tool.description, item => typeof item === "string")))
        && optional(data.temperature, finite) && optional(data.maxTokens, integer);
    case "assistant-message":
      return message(data.message, "assistant") && finish(data.finishReason)
        && optional(data.usage, usage);
    case "tool-call-requested": return block(data.toolCall) && record(data.toolCall) && data.toolCall.type === "tool-call";
    case "tool-call-result":
      return message(data.message, "user") && record(data.message)
        && Array.isArray(data.message.content) && data.message.content.length === 1
        && record(data.message.content[0]) && data.message.content[0].type === "tool-result";
    default: return false;
  }
}

function message(value: unknown, role?: string): boolean {
  if (!record(value) || !text(value.id) || !oneOf(value.role, ["system", "user", "assistant"])
      || (role !== undefined && value.role !== role) || !Array.isArray(value.content)) return false;
  if (!value.content.every(item => block(item)
      || (value.role === "user" && resultBlock(item)))) return false;
  return optional(value.replay, replay);
}

function block(value: unknown): boolean {
  if (!record(value)) return false;
  if (value.type === "text" || value.type === "reasoning") return typeof value.text === "string";
  return value.type === "tool-call" && text(value.id)
    && typeof value.name === "string" && typeof value.arguments === "string";
}

function resultBlock(value: unknown): boolean {
  return record(value) && value.type === "tool-result" && text(value.toolCallId)
    && typeof value.isError === "boolean" && Array.isArray(value.content) && value.content.every(block);
}

function replay(value: unknown): boolean {
  return record(value) && value.version === 1 && text(value.protocol)
    && record(value.source) && text(value.source.provider) && text(value.source.model)
    && Array.isArray(value.items) && value.items.every(item => record(item)
      && (item.contentIndex === null || integer(item.contentIndex)) && record(item.payload));
}

function finish(value: unknown): boolean {
  return record(value) && (oneOf(value.kind, ["stop", "tool-calls", "max-tokens", "content-filter", "cancelled"])
    || (value.kind === "error" && failure(value.failure)));
}

function failure(value: unknown): boolean {
  return record(value) && text(value.code) && typeof value.message === "string"
    && optional(value.status, integer) && optional(value.retryAfterMs, finite)
    && optional(value.exposeCode, item => typeof item === "boolean");
}

function usage(value: unknown): boolean {
  return record(value) && integer(value.inputTokens) && integer(value.outputTokens)
    && ["totalTokens", "cacheReadTokens", "cacheWriteTokens", "reasoningTokens"].every(key => optional(value[key], integer));
}

function surfaceOp(value: unknown): boolean {
  return value === undefined || value === "append" || (record(value) && value.op === "replace"
    && integer(value.start) && integer(value.end) && (value.start as number) > 0 && (value.end as number) >= (value.start as number));
}

function status(value: unknown, step: boolean): boolean {
  return oneOf(value, ["completed", "blocked", "cancelled", "failed", ...(step ? ["continue"] : [])]);
}

function oneOf(value: unknown, choices: readonly string[]): boolean {
  return typeof value === "string" && choices.includes(value);
}

function optional(value: unknown, validate: (value: unknown) => boolean): boolean {
  return value === undefined || validate(value);
}

function text(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function integer(value: unknown): boolean {
  return finite(value) && Number.isSafeInteger(value) && value >= 0;
}

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function json(value: unknown, ancestors = new Set<object>()): boolean {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (!Array.isArray(value) && !record(value)) return false;
  if (ancestors.has(value)) return false;
  ancestors.add(value);
  const valid = (Array.isArray(value) ? Array.from(value) : Object.values(value)).every(item => json(item, ancestors));
  ancestors.delete(value);
  return valid;
}

function invalid(sequence: number, reason: string): SessionError {
  return new SessionError("invalid-history", `Session event ${sequence}: ${reason}.`);
}

function deepFreeze<TValue>(value: TValue): TValue {
  if (value !== null && typeof value === "object") {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
