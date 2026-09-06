import { SearchError } from "./errors.js";
import type { SearchRequest, SearchResult, SearchSource } from "./types.js";

export const SEARCH_LIMITS = Object.freeze({
  queryLength: 2000,
  defaultResults: 8,
  maxResults: 20,
  titleLength: 300,
  summaryLength: 2000,
  urlLength: 8192,
  defaultTimeoutMs: 30_000,
  maxTimeoutMs: 300_000,
});

/** Copy only accepted request fields; never forward provider/key overrides. */
export function normalizeSearchRequest(value: unknown): Required<SearchRequest> {
  if (!isRecord(value)) throw invalidRequest();
  const query = value.query;
  const maxResults = value.maxResults === undefined
    ? SEARCH_LIMITS.defaultResults : value.maxResults;
  if (typeof query !== "string" || !query.trim() ||
      query.length > SEARCH_LIMITS.queryLength ||
      typeof maxResults !== "number" || !Number.isInteger(maxResults) ||
      maxResults < 1 || maxResults > SEARCH_LIMITS.maxResults) {
    throw invalidRequest();
  }
  return Object.freeze({ query: query.trim(), maxResults });
}

export function resolveSearchTimeout(value: unknown): number {
  if (value === undefined) return SEARCH_LIMITS.defaultTimeoutMs;
  if (typeof value !== "number" || !Number.isInteger(value) ||
      value < 1 || value > SEARCH_LIMITS.maxTimeoutMs) {
    throw new SearchError("invalid-config", "Search timeout is outside the supported range.");
  }
  return value;
}

/** Validate only the retained prefix: discarded data cannot enter the result. */
export function normalizeSearchResult(value: unknown, maxResults: number): SearchResult {
  if (!isRecord(value) || !Array.isArray(value.sources) ||
      typeof value.truncated !== "boolean") {
    throw invalidResponse();
  }
  const sources: SearchSource[] = [];
  let truncated = value.truncated || value.sources.length > maxResults;
  for (const raw of value.sources.slice(0, maxResults)) {
    if (!isRecord(raw)) throw invalidResponse();
    const title = requiredText(raw.title);
    const summary = requiredText(raw.summary);
    const url = sourceUrl(raw.url);
    const publishedAt = raw.publishedAt;
    if (publishedAt !== undefined && (typeof publishedAt !== "string" ||
        publishedAt.length > 64 || !/^\d{4}-\d{2}-\d{2}T/.test(publishedAt) ||
        !Number.isFinite(Date.parse(publishedAt)))) {
      throw invalidResponse();
    }
    truncated ||= title.length > SEARCH_LIMITS.titleLength ||
      summary.length > SEARCH_LIMITS.summaryLength;
    sources.push(Object.freeze({
      title: title.slice(0, SEARCH_LIMITS.titleLength),
      url,
      summary: summary.slice(0, SEARCH_LIMITS.summaryLength),
      ...(publishedAt === undefined ? {} : { publishedAt: publishedAt as string }),
    }));
  }
  return Object.freeze({ sources: Object.freeze(sources), truncated });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requiredText(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) throw invalidResponse();
  return value.trim();
}

/** Syntax-only validation, not SSRF protection: search never fetches source URLs. */
function sourceUrl(value: unknown): string {
  const text = requiredText(value);
  if (text.length > SEARCH_LIMITS.urlLength) throw invalidResponse();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    throw invalidResponse();
  }
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
    throw invalidResponse();
  }
  return text;
}

function invalidRequest(): SearchError {
  return new SearchError("invalid-request", "Invalid search query or result limit.");
}

function invalidResponse(): SearchError {
  return new SearchError("invalid-response", "Search response does not match the source protocol.");
}
