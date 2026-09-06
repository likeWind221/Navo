import { FetchError } from "./errors.js";
import { FETCH_URL_MAX_LENGTH, validateFetchUrl } from "./policy.js";
import type { FetchBody, FetchRequest, FetchResult } from "./types.js";

export const FETCH_CORE_LIMITS = Object.freeze({
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 300_000,
  defaultBodyCharacters: 100_000,
  maxBodyCharacters: 1_000_000,
});

export interface FetchCoreConfig {
  readonly timeoutMs?: number;
  readonly maxBodyCharacters?: number;
}

export interface ResolvedFetchCoreConfig {
  readonly timeoutMs: number;
  readonly maxBodyCharacters: number;
}

/** Copy the sole accepted request field without retaining caller state. */
export function normalizeFetchRequest(value: unknown): FetchRequest {
  if (!isRecord(value) || typeof value.url !== "string") {
    throw new FetchError("invalid-request", "Fetch request must contain a URL string.");
  }
  const url = value.url.trim();
  if (!url) {
    throw new FetchError("invalid-request", "Fetch request URL is blank.");
  }
  return Object.freeze({ url: validateFetchUrl(url).toString() });
}

/** Validate trusted scalar limits once when constructing FetchCore. */
export function resolveFetchCoreConfig(
  value: FetchCoreConfig = {},
): ResolvedFetchCoreConfig {
  const timeoutMs = positiveInteger(
    value.timeoutMs,
    FETCH_CORE_LIMITS.defaultTimeoutMs,
    FETCH_CORE_LIMITS.maxTimeoutMs,
    "timeoutMs",
  );
  const maxBodyCharacters = positiveInteger(
    value.maxBodyCharacters,
    FETCH_CORE_LIMITS.defaultBodyCharacters,
    FETCH_CORE_LIMITS.maxBodyCharacters,
    "maxBodyCharacters",
  );
  return Object.freeze({ timeoutMs, maxBodyCharacters });
}

/** Accept only a complete result protocol and detach its bounded content. */
export function normalizeFetchResult(
  value: unknown,
  maxBodyCharacters: number,
): FetchResult {
  if (!isRecord(value) || typeof value.url !== "string" ||
      typeof value.statusCode !== "number" ||
      !Number.isInteger(value.statusCode) || value.statusCode < 100 ||
      value.statusCode > 599) {
    throw invalidResponse();
  }
  const url = resultUrl(value.url);
  const body = normalizeBody(value.body, maxBodyCharacters);
  return Object.freeze({
    url,
    statusCode: value.statusCode,
    body,
  });
}

function normalizeBody(value: unknown, limit: number): FetchBody {
  if (!isRecord(value) || typeof value.content !== "string") {
    throw invalidResponse();
  }
  if (value.content.length > limit) {
    throw new FetchError(
      "response-too-large",
      `Fetch body exceeds the complete-document limit of ${limit} characters.`,
    );
  }
  if (value.kind === "html") {
    return Object.freeze({ kind: "html", content: value.content });
  }
  if (value.kind === "text" &&
      (value.format === "markdown" || value.format === "plain")) {
    return Object.freeze({ kind: "text", format: value.format, content: value.content });
  }
  throw invalidResponse();
}

function resultUrl(value: string): string {
  if (!value || value.length > FETCH_URL_MAX_LENGTH) throw invalidResponse();
  try {
    return validateFetchUrl(value).toString();
  } catch {
    throw invalidResponse();
  }
}

function positiveInteger(
  value: number | undefined,
  fallback: number,
  maximum: number,
  name: string,
): number {
  const resolved = value ?? fallback;
  if (!Number.isInteger(resolved) || resolved < 1 || resolved > maximum) {
    throw new FetchError(
      "invalid-config",
      `Fetch ${name} must be an integer between 1 and ${maximum}.`,
    );
  }
  return resolved;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidResponse(): FetchError {
  return new FetchError(
    "invalid-response",
    "Fetch implementation returned a value outside the result protocol.",
  );
}
