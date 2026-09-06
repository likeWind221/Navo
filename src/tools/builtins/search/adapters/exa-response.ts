import { SearchError } from "../errors.js";
import type { SearchResult, SearchSource } from "../types.js";
import { normalizeSearchResult } from "../validation.js";

export const EXA_MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

/** Bound decoded response bytes before parsing; never read provider error messages. */
export async function readExaResponse(response: Response, signal?: AbortSignal): Promise<unknown> {
  const reader = response.body?.getReader();
  let complete = false;
  try {
    assertActive(signal);
    if (!response.ok || response.redirected) {
      throw new SearchError("request-failed", `Exa returned HTTP ${response.status} or a redirected response.`);
    }
    const contentType = response.headers.get("content-type")?.split(";")[0]?.trim().toLowerCase();
    if (!contentType || !/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)$/.test(contentType)) {
      throw invalidResponse();
    }
    const length = Number(response.headers.get("content-length"));
    if (Number.isFinite(length) && length > EXA_MAX_RESPONSE_BYTES) throw tooLarge();
    if (!reader) throw invalidResponse();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const parts: string[] = [];
    let bytes = 0;
    while (true) {
      assertActive(signal);
      const { done, value } = await reader.read();
      assertActive(signal);
      if (done) {
        complete = true;
        break;
      }
      bytes += value.byteLength;
      if (bytes > EXA_MAX_RESPONSE_BYTES) throw tooLarge();
      parts.push(decoder.decode(value, { stream: true }));
    }
    parts.push(decoder.decode());
    try {
      return JSON.parse(parts.join("")) as unknown;
    } catch {
      // Do not retain parse errors, which can include fragments of the raw body.
      throw invalidResponse();
    }
  } finally {
    if (reader) {
      if (!complete) {
        try { await reader.cancel(); } catch { /* Preserve the primary failure. */ }
      }
      reader.releaseLock();
    }
  }
}

/** Vendor shape validation precedes the common result boundary. */
export function mapExaResponse(payload: unknown, maxResults: number): SearchResult {
  if (!isRecord(payload) || !Array.isArray(payload.results)) throw invalidResponse();
  const sources: SearchSource[] = [];
  let truncated = false;
  for (const raw of payload.results) {
    const source = mapExaSource(raw);
    if (source) sources.push(source);
    else truncated = true;
  }
  return normalizeSearchResult({ sources, truncated }, maxResults);
}

function mapExaSource(raw: unknown): SearchSource | undefined {
  if (!isRecord(raw) || typeof raw.url !== "string" || !raw.url.trim()) {
    throw invalidResponse();
  }
  if (raw.title != null && typeof raw.title !== "string") throw invalidResponse();
  const highlights = raw.highlights;
  if (highlights != null && (!Array.isArray(highlights) ||
      !highlights.every((item: unknown) => typeof item === "string"))) {
    throw invalidResponse();
  }
  const summary = (highlights as string[] | null | undefined)?.find((item) => item.trim())?.trim();
  if (!summary) return undefined;
  const publishedAt = publicationTime(raw.publishedDate);
  return {
    url: raw.url.trim(),
    title: typeof raw.title === "string" && raw.title.trim() ? raw.title.trim() : raw.url.trim(),
    summary,
    ...(publishedAt === undefined ? {} : { publishedAt }),
  };
}

/** Date-only values are omitted: the public protocol requires a time, not invented midnight. */
function publicationTime(value: unknown): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") throw invalidResponse();
  const text = value.trim();
  if (!text || /^\d{4}-\d{2}-\d{2}$/.test(text)) return undefined;
  if (text.length > 64 || !/^\d{4}-\d{2}-\d{2}T/.test(text) || !Number.isFinite(Date.parse(text))) {
    throw invalidResponse();
  }
  return text;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function assertActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted) throw new SearchError("aborted", "Exa response reading was cancelled.");
}

function tooLarge(): SearchError {
  return new SearchError("response-too-large", "Exa response exceeds the 5 MiB byte budget.");
}

function invalidResponse(): SearchError {
  return new SearchError("invalid-response", "Exa returned an invalid JSON search response.");
}
