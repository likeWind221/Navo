import { SearchError } from "./errors.js";
import type { SearchAdapter, SearchRequest, SearchResult } from "./types.js";
import {
  normalizeSearchRequest,
  normalizeSearchResult,
  resolveSearchTimeout,
} from "./validation.js";

export interface SearchExecutionOptions {
  readonly timeoutMs?: number;
  readonly signals?: readonly AbortSignal[];
}

/** Own one operation's deadline/listeners and observe even late adapter rejection. */
export async function executeSearch(
  adapter: SearchAdapter | undefined,
  request: SearchRequest,
  options: SearchExecutionOptions = {},
): Promise<SearchResult> {
  const signals = options.signals ?? [];
  assertSearchActive(signals);
  const normalized = normalizeSearchRequest(request);
  const timeoutMs = resolveSearchTimeout(options.timeoutMs);
  assertSearchAdapter(adapter);
  const controller = new AbortController();
  const deadline = performance.now() + timeoutMs;
  return await new Promise<SearchResult>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(onTimeout, timeoutMs);
    for (const signal of signals) signal.addEventListener("abort", onAbort, { once: true });

    function finish(error: SearchError | undefined, result?: SearchResult): void {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      for (const signal of signals) signal.removeEventListener("abort", onAbort);
      if (error) {
        reject(error);
        controller.abort(error);
      } else {
        resolve(result!);
      }
    }

    function onAbort(): void {
      finish(new SearchError("aborted", "Search was cancelled."));
    }

    function onTimeout(): void {
      if (signals.some((signal) => signal.aborted)) return onAbort();
      finish(new SearchError("timeout", "Search exceeded its execution deadline."));
    }

    function accept(value: unknown, failed: boolean): void {
      if (settled) return;
      if (signals.some((signal) => signal.aborted)) return onAbort();
      if (performance.now() >= deadline) return onTimeout();
      if (failed) {
        finish(normalizeSearchError(value));
        return;
      }
      try {
        const result = normalizeSearchResult(value, normalized.maxResults);
        if (signals.some((signal) => signal.aborted)) return onAbort();
        if (performance.now() >= deadline) return onTimeout();
        finish(undefined, result);
      } catch (error) {
        finish(normalizeSearchError(error));
      }
    }

    try {
      // Call synchronously so pre-cancellation cannot race an unobserved microtask.
      Promise.resolve(adapter.search(normalized, controller.signal)).then(
        (value) => accept(value, false),
        (error: unknown) => accept(error, true),
      );
    } catch (error) {
      accept(error, true);
    }
  });
}

function assertSearchAdapter(
  adapter: SearchAdapter | undefined,
): asserts adapter is SearchAdapter {
  if (adapter === undefined) {
    throw new SearchError("provider-unavailable", "No search adapter is configured.");
  }
  if (typeof adapter.id !== "string" ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(adapter.id) ||
      typeof adapter.search !== "function") {
    throw new SearchError("invalid-adapter", "Search adapter configuration is invalid.");
  }
}

export function assertSearchActive(signals: readonly AbortSignal[]): void {
  if (signals.some((signal) => signal.aborted)) {
    throw new SearchError("aborted", "Search was cancelled before execution.");
  }
}

function normalizeSearchError(error: unknown): SearchError {
  if (error instanceof SearchError) return error;
  return new SearchError("request-failed", "Search adapter execution failed.", { cause: error });
}
