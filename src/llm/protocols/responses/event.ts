import { LLMProviderError } from "../../errors.js";
import type { JsonObject } from "../../types.js";

export function parseEvent(payload: string): JsonObject {
  try {
    const value = JSON.parse(payload) as unknown;
    if (!isJsonObject(value)) throw new TypeError("event is not an object");
    return value;
  } catch (cause: unknown) {
    throw invalidEvent("data is not valid JSON.", cause);
  }
}

export function objectValue(value: unknown): JsonObject | undefined {
  return isJsonObject(value) ? value : undefined;
}

export function requiredObject(value: unknown): JsonObject {
  const result = objectValue(value);
  if (result === undefined) throw invalidEvent("event object field is invalid.");
  return result;
}

export function arrayValue(value: unknown): readonly unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function requiredString(value: unknown): string {
  const result = stringValue(value);
  if (result === undefined) throw invalidEvent("event string field is invalid.");
  return result;
}

export function requiredIndex(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw invalidEvent("event output index is invalid.");
  }
  return value as number;
}

export function count(value: unknown): number | undefined {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? value as number : undefined;
}

export function invalidEvent(message: string, cause?: unknown): LLMProviderError {
  return new LLMProviderError("TRANSPORT", `Responses SSE ${message}`, cause === undefined ? {} : { cause });
}

export function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
