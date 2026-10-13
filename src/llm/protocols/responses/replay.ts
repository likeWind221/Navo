import type { JsonObject, ReplayEnvelope, ReplayItem } from "../../types.js";

export function createResponsesReplay(
  provider: string,
  model: string,
  items: readonly ReplayItem[],
): ReplayEnvelope {
  return Object.freeze({
    version: 1 as const,
    protocol: "responses" as const,
    source: Object.freeze({ provider, model }),
    items: Object.freeze([...items]),
  });
}

export function readResponsesReplay(
  replay: ReplayEnvelope,
  provider: string,
  model: string,
): readonly ReplayItem[] {
  if (replay.version !== 1 || replay.protocol !== "responses") {
    throw invalidReplay("version or protocol is unsupported");
  }
  if (replay.source.provider !== provider || replay.source.model !== model) {
    throw invalidReplay("source does not match the request");
  }
  if (!Array.isArray(replay.items)) throw invalidReplay("items are invalid");
  return replay.items.map((item) => {
    if (!isReplayItem(item)) throw invalidReplay("item is invalid");
    if (!isResponsesPayload(item.payload)) throw invalidReplay("payload is invalid");
    return item;
  });
}

function isReplayItem(value: unknown): value is ReplayItem {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const item = value as { readonly contentIndex?: unknown; readonly payload?: unknown };
  return (item.contentIndex === null
      || (Number.isSafeInteger(item.contentIndex) && (item.contentIndex as number) >= 0))
    && isResponsesPayload(item.payload);
}

function isResponsesPayload(value: unknown): value is JsonObject {
  if (!isJsonObject(value)) return false;
  if (value.type === "message") {
    return typeof value.id === "string" && value.role === "assistant"
      && validPhase(value.phase) && validMessageContent(value.content);
  }
  if (value.type === "reasoning") {
    return typeof value.id === "string" && validSummary(value.summary);
  }
  if (value.type === "function_call") {
    return typeof value.id === "string" && typeof value.call_id === "string"
      && typeof value.name === "string" && typeof value.namespace === "string"
      && typeof value.arguments === "string";
  }
  return false;
}

function validPhase(value: unknown): boolean {
  return value === undefined || value === null
    || value === "commentary" || value === "final_answer";
}

function validMessageContent(value: unknown): boolean {
  return Array.isArray(value) && value.length > 0 && value.every((part) => {
    if (!isJsonObject(part)) return false;
    if (part.type === "output_text") return typeof part.text === "string";
    if (part.type === "refusal") return typeof part.refusal === "string";
    return false;
  });
}

function validSummary(value: unknown): boolean {
  return Array.isArray(value) && value.every((part) =>
    isJsonObject(part) && part.type === "summary_text" && typeof part.text === "string");
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidReplay(message: string): TypeError {
  return new TypeError(`Responses replay ${message}.`);
}
