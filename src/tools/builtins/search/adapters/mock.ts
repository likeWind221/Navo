import { SearchError } from "../errors.js";
import type { SearchAdapter, SearchRequest, SearchResult } from "../types.js";

export type MockSearchEntry =
  | { readonly kind: "result"; readonly result: SearchResult }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "hang" };

/** Offline scripted adapter; opt-in only, never installed by the default app. */
export class MockSearchAdapter implements SearchAdapter {
  readonly id: string;
  private readonly entries: readonly MockSearchEntry[];
  private readonly recordedRequests: SearchRequest[] = [];
  private cursor = 0;

  constructor(entries: readonly MockSearchEntry[], id = "mock") {
    this.id = id;
    this.entries = Object.freeze(entries.map(snapshotEntry));
  }

  get requests(): readonly SearchRequest[] {
    return Object.freeze([...this.recordedRequests]);
  }

  get remainingEntries(): number {
    return this.entries.length - this.cursor;
  }

  /** Consume in invocation order, not completion order; pre-abort consumes nothing. */
  async search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult> {
    assertActive(signal);
    this.recordedRequests.push(snapshotRequest(request));
    const entry = this.entries[this.cursor];
    if (!entry) {
      throw new SearchError("request-failed", "Mock search script is exhausted.");
    }
    this.cursor++;
    switch (entry.kind) {
      case "result":
        return entry.result;
      case "error":
        throw entry.error;
      case "hang":
        return waitForAbort(signal);
    }
  }
}

/** Snapshot script data, but preserve the identity of deliberately injected errors. */
function snapshotEntry(entry: MockSearchEntry): MockSearchEntry {
  switch (entry.kind) {
    case "result":
      return Object.freeze({ kind: "result", result: snapshotResult(entry.result) });
    case "error":
      return Object.freeze({ kind: "error", error: entry.error });
    case "hang":
      return Object.freeze({ kind: "hang" });
  }
}

/** Do not normalize/cap here: the real service must remain testable independently. */
function snapshotResult(result: SearchResult): SearchResult {
  return Object.freeze({
    truncated: result.truncated,
    sources: Object.freeze(result.sources.map((source) => Object.freeze({
      title: source.title,
      url: source.url,
      summary: source.summary,
      ...(source.publishedAt === undefined ? {} : { publishedAt: source.publishedAt }),
    }))),
  });
}

function snapshotRequest(request: SearchRequest): SearchRequest {
  return Object.freeze({
    query: request.query,
    ...(request.maxResults === undefined ? {} : { maxResults: request.maxResults }),
  });
}

function assertActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new SearchError("aborted", "Mock search was cancelled.");
  }
}

/** Without a signal this intentionally stays pending, but owns no timer or handle. */
function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  assertActive(signal);
  return new Promise<never>((_resolve, reject) => {
    if (!signal) return;
    function onAbort(): void {
      signal!.removeEventListener("abort", onAbort);
      reject(new SearchError("aborted", "Mock search was cancelled while waiting."));
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}
