import { CONTENT_MAX_COUNT, CONTENT_TURN_MAX_CHARS } from "../../shared/content.js";
import { RpcError } from "../errors.js";
import type {
  SessionCompactionEventV1,
  SessionContextBudgetV1,
  SessionContextFollowEventV1,
  SessionContextFollowInputV1,
  SessionContextInputV1,
  SessionContextMeasurementV1,
  SessionContextSnapshotV1,
  SessionHistoryContentV1,
  SessionHistoryCursorV1,
  SessionHistoryEntryV1,
  SessionHistoryInputV1,
  SessionHistoryMessageV1,
  SessionHistoryV1,
} from "../session.js";
import { SESSION_HISTORY_PAGE_MAX } from "../session.js";
import { exactKeys, requireBoundedString, requireRecord } from "../validation.js";

const ID_MAX = 128;
const NAME_MAX = 256;
const TIMESTAMP_MAX = 64;
const CONTENT_DEPTH_MAX = 8;

export function parseSessionContextInput(value: unknown): SessionContextInputV1 {
  const input = shape(value, ["sessionId"], [], "session context input");
  return { sessionId: id(input.sessionId, "sessionId") };
}

export function parseSessionContextFollowInput(value: unknown): SessionContextFollowInputV1 {
  const input = shape(value, ["sessionId"], [], "session context follow input");
  return { sessionId: id(input.sessionId, "sessionId") };
}

export function parseSessionHistoryInput(value: unknown): SessionHistoryInputV1 {
  const input = shape(value, ["sessionId", "limit"], ["cursor"], "session history input");
  if (!Number.isSafeInteger(input.limit) || (input.limit as number) < 1
    || (input.limit as number) > SESSION_HISTORY_PAGE_MAX) {
    invalid("Session history limit is out of range");
  }
  const cursor = input.cursor === undefined ? undefined : parseCursor(input.cursor);
  return {
    sessionId: id(input.sessionId, "sessionId"),
    limit: input.limit as number,
    ...(cursor === undefined ? {} : { cursor }),
  };
}

export function parseSessionContextSnapshot(value: unknown): SessionContextSnapshotV1 {
  const snapshot = shape(value,
    ["sessionId", "eventSequence", "surfaceGeneration", "measuredAt", "measurement", "budget"],
    [], "session context snapshot");
  return {
    sessionId: id(snapshot.sessionId, "snapshot sessionId"),
    eventSequence: count(snapshot.eventSequence, "eventSequence"),
    surfaceGeneration: count(snapshot.surfaceGeneration, "surfaceGeneration"),
    measuredAt: timestamp(snapshot.measuredAt, "measuredAt"),
    measurement: parseMeasurement(snapshot.measurement),
    budget: parseBudget(snapshot.budget),
  };
}

export function parseSessionContextFollowEvent(value: unknown): SessionContextFollowEventV1 {
  const frame = requireRecord(value, "session context follow frame");
  if (frame.type === "snapshot" && exactKeys(frame, ["type", "snapshot"])) {
    return { type: "snapshot", snapshot: parseSessionContextSnapshot(frame.snapshot) };
  }
  if (frame.type === "context-updated" && exactKeys(frame, ["type", "snapshot"])) {
    return { type: "context-updated", snapshot: parseSessionContextSnapshot(frame.snapshot) };
  }
  if (frame.type === "compaction-event" && exactKeys(frame, ["type", "event"])) {
    return { type: "compaction-event", event: parseCompactionEvent(frame.event) };
  }
  return invalid("Malformed session context follow frame");
}

export function parseSessionHistory(value: unknown): SessionHistoryV1 {
  const history = shape(value, ["sessionId", "surfaceGeneration", "entries", "nextCursor"], [], "session history");
  return {
    sessionId: id(history.sessionId, "history sessionId"),
    surfaceGeneration: count(history.surfaceGeneration, "history surfaceGeneration"),
    entries: array(history.entries, "history entries").map(parseHistoryEntry),
    nextCursor: history.nextCursor === null ? null : parseCursor(history.nextCursor),
  };
}

export function parseSessionHistoryMessage(value: unknown): SessionHistoryMessageV1 {
  const message = shape(value, ["id", "role", "content"], [], "history message");
  return {
    id: id(message.id, "message id"),
    role: oneOf(message.role, ["user", "assistant"] as const, "message role"),
    content: content(message.content, 0),
  };
}

function parseHistoryEntry(value: unknown): SessionHistoryEntryV1 {
  const entry = requireRecord(value, "history entry");
  if (entry.kind === "message") {
    const message = shape(entry, ["kind", "sequence", "timestamp", "message"], [], "history message entry");
    return {
      kind: "message",
      sequence: positive(message.sequence, "message sequence"),
      timestamp: timestamp(message.timestamp, "message timestamp"),
      message: parseSessionHistoryMessage(message.message),
    };
  }
  if (entry.kind === "summary-checkpoint") {
    const checkpoint = shape(entry,
      ["kind", "sequence", "timestamp", "message", "compactionId", "coveredStart", "coveredEnd", "summaryVersion"],
      [], "history summary checkpoint");
    return {
      kind: "summary-checkpoint",
      sequence: positive(checkpoint.sequence, "checkpoint sequence"),
      timestamp: timestamp(checkpoint.timestamp, "checkpoint timestamp"),
      message: parseSessionHistoryMessage(checkpoint.message),
      compactionId: id(checkpoint.compactionId, "compactionId"),
      coveredStart: positive(checkpoint.coveredStart, "coveredStart"),
      coveredEnd: positive(checkpoint.coveredEnd, "coveredEnd"),
      summaryVersion: summaryVersion(checkpoint.summaryVersion),
    };
  }
  return invalid("Malformed history entry");
}

function parseCursor(value: unknown): SessionHistoryCursorV1 {
  const cursor = shape(value, ["surfaceGeneration", "offset"], [], "history cursor");
  return {
    surfaceGeneration: count(cursor.surfaceGeneration, "cursor surfaceGeneration"),
    offset: count(cursor.offset, "cursor offset"),
  };
}

function parseMeasurement(value: unknown): SessionContextMeasurementV1 {
  const measurement = shape(value, ["usedTokens", "estimatedRequestTokens", "basis"], [], "context measurement");
  return {
    usedTokens: count(measurement.usedTokens, "usedTokens"),
    estimatedRequestTokens: count(measurement.estimatedRequestTokens, "estimatedRequestTokens"),
    basis: oneOf(measurement.basis, ["usage", "estimate"] as const, "measurement basis"),
  };
}

function parseBudget(value: unknown): SessionContextBudgetV1 {
  const record = requireRecord(value, "context budget");
  if (record.kind === "enabled") {
    const budget = shape(record,
      ["kind", "reservedOutputTokens", "thresholdTokens", "retainTokens", "exceeded"],
      ["contextWindow"], "enabled context budget");
    return {
      kind: "enabled",
      ...(budget.contextWindow === undefined ? {}
        : { contextWindow: positive(budget.contextWindow, "contextWindow") }),
      reservedOutputTokens: count(budget.reservedOutputTokens, "reservedOutputTokens"),
      thresholdTokens: positive(budget.thresholdTokens, "thresholdTokens"),
      retainTokens: count(budget.retainTokens, "retainTokens"),
      exceeded: flag(budget.exceeded, "exceeded"),
    };
  }
  if (record.kind === "disabled") {
    const budget = shape(record, ["kind", "reason"], [], "disabled context budget");
    return {
      kind: "disabled",
      reason: oneOf(budget.reason, ["missing-capacity", "no-pressure-budget"] as const, "disabled budget reason"),
    };
  }
  return invalid("Malformed context budget");
}

function parseCompactionEvent(value: unknown): SessionCompactionEventV1 {
  const event = requireRecord(value, "compaction event");
  if (event.kind === "started") {
    const started = shape(event,
      ["kind", "sessionId", "sequence", "timestamp", "compactionId", "trigger",
        "coveredStart", "coveredEnd"],
      ["turnId"], "compaction started event");
    return {
      kind: "started",
      sessionId: id(started.sessionId, "compaction sessionId"),
      sequence: positive(started.sequence, "compaction sequence"),
      timestamp: timestamp(started.timestamp, "compaction timestamp"),
      compactionId: id(started.compactionId, "compactionId"),
      trigger: oneOf(started.trigger, ["pressure", "overflow", "manual"] as const, "compaction trigger"),
      coveredStart: positive(started.coveredStart, "coveredStart"),
      coveredEnd: positive(started.coveredEnd, "coveredEnd"),
      ...(started.turnId === undefined ? {} : { turnId: id(started.turnId, "compaction turnId") }),
    };
  }
  if (event.kind === "checkpoint") {
    const checkpoint = shape(event,
      ["kind", "sessionId", "sequence", "timestamp", "compactionId",
        "coveredStart", "coveredEnd", "summaryVersion", "surfaceGeneration"],
      [], "compaction checkpoint event");
    return {
      kind: "checkpoint",
      sessionId: id(checkpoint.sessionId, "compaction sessionId"),
      sequence: positive(checkpoint.sequence, "compaction sequence"),
      timestamp: timestamp(checkpoint.timestamp, "compaction timestamp"),
      compactionId: id(checkpoint.compactionId, "compactionId"),
      coveredStart: positive(checkpoint.coveredStart, "coveredStart"),
      coveredEnd: positive(checkpoint.coveredEnd, "coveredEnd"),
      summaryVersion: summaryVersion(checkpoint.summaryVersion),
      surfaceGeneration: count(checkpoint.surfaceGeneration, "checkpoint surfaceGeneration"),
    };
  }
  if (event.kind === "ended") {
    const ended = shape(event,
      ["kind", "sessionId", "sequence", "timestamp", "compactionId", "status"],
      ["beforeTokens", "afterTokens", "summaryTokens", "provider", "model", "failure"],
      "compaction ended event");
    return {
      kind: "ended",
      sessionId: id(ended.sessionId, "compaction sessionId"),
      sequence: positive(ended.sequence, "compaction sequence"),
      timestamp: timestamp(ended.timestamp, "compaction timestamp"),
      compactionId: id(ended.compactionId, "compactionId"),
      status: oneOf(ended.status, ["completed", "failed", "cancelled", "interrupted"] as const, "compaction status"),
      ...(ended.beforeTokens === undefined ? {} : { beforeTokens: count(ended.beforeTokens, "beforeTokens") }),
      ...(ended.afterTokens === undefined ? {} : { afterTokens: count(ended.afterTokens, "afterTokens") }),
      ...(ended.summaryTokens === undefined ? {} : { summaryTokens: count(ended.summaryTokens, "summaryTokens") }),
      ...(ended.provider === undefined ? {} : { provider: id(ended.provider, "compaction provider") }),
      ...(ended.model === undefined ? {} : { model: id(ended.model, "compaction model") }),
      ...(ended.failure === undefined ? {} : { failure: parseCompactionFailure(ended.failure) }),
    };
  }
  return invalid("Malformed compaction event");
}

function parseCompactionFailure(value: unknown): { readonly code: string; readonly message: string } {
  const failure = shape(value, ["code", "message"], [], "compaction failure");
  return {
    code: id(failure.code, "compaction failure code"),
    message: text(failure.message, "compaction failure message", 4_096),
  };
}

function content(value: unknown, depth: number): readonly SessionHistoryContentV1[] {
  if (depth > CONTENT_DEPTH_MAX) invalid("History content nesting is too deep");
  return array(value, "history content").map(block => parseContentBlock(block, depth));
}

function parseContentBlock(value: unknown, depth: number): SessionHistoryContentV1 {
  const block = requireRecord(value, "history content block");
  if ((block.type === "text" || block.type === "reasoning")
    && exactKeys(block, ["type", "text"])) {
    return { type: block.type, text: text(block.text, "content text", CONTENT_TURN_MAX_CHARS) };
  }
  if (block.type === "tool-call" && exactKeys(block, ["type", "id", "name", "arguments"])) {
    return {
      type: "tool-call",
      id: id(block.id, "tool call id"),
      name: text(block.name, "tool name", NAME_MAX),
      arguments: text(block.arguments, "tool arguments", CONTENT_TURN_MAX_CHARS),
    };
  }
  if (block.type === "tool-result" && exactKeys(block, ["type", "toolCallId", "content", "isError"])) {
    return {
      type: "tool-result",
      toolCallId: id(block.toolCallId, "tool result call id"),
      content: content(block.content, depth + 1),
      isError: flag(block.isError, "tool result isError"),
    };
  }
  return invalid("Malformed history content block");
}

function summaryVersion(value: unknown): 1 {
  if (value !== 1) invalid("Unsupported summary version");
  return 1;
}

function shape(
  value: unknown,
  required: readonly string[],
  optional: readonly string[],
  label: string,
): Record<string, unknown> {
  const record = requireRecord(value, label);
  for (const key of Reflect.ownKeys(record)) {
    if (typeof key !== "string" || (!required.includes(key) && !optional.includes(key))) {
      invalid(`Malformed ${label}`);
    }
  }
  for (const key of required) {
    if (!Object.hasOwn(record, key)) invalid(`Malformed ${label}`);
  }
  return record;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  if (value.length > CONTENT_MAX_COUNT) invalid(`${label} exceeds the item limit`);
  return value;
}

function id(value: unknown, label: string): string {
  return requireBoundedString(value, label, ID_MAX);
}

function text(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.length > maximum) invalid(`${label} must be text`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  const result = requireBoundedString(value, label, TIMESTAMP_MAX);
  if (!Number.isFinite(Date.parse(result))) invalid(`${label} must be an ISO timestamp`);
  return result;
}

function flag(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(`${label} must be a boolean`);
  return value;
}

function count(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(`${label} must be a non-negative integer`);
  return value as number;
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid(`${label} must be a positive integer`);
  return value as number;
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) invalid(`Invalid ${label}`);
  return value as T[number];
}

function invalid(message: string): never {
  throw new RpcError("invalid-frame", message);
}
