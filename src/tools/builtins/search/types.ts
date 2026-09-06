/** Provider-neutral search capability; no host, model, or learning-domain imports. */
export interface SearchAdapter {
  /** Stable implementation identity used for trusted configuration diagnostics. */
  readonly id: string;
  /** Cooperatively honor cancellation; never return provider-specific raw data. */
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult>;
}

export interface SearchRequest {
  readonly query: string;
  /** Integer 1–20; the tool normalizes omission to 8 and enforces the bound. */
  readonly maxResults?: number;
}

export interface SearchResult {
  /** An empty array is a valid search outcome, not a transport failure. */
  readonly sources: readonly SearchSource[];
  /** Whether the adapter or execution boundary omitted/truncated source data. */
  readonly truncated: boolean;
}

/** Untrusted source data, not instructions; adapters must not invent summaries. */
export interface SearchSource {
  readonly title: string;
  /** Absolute HTTP(S) URL; runtime validation belongs to the execution boundary. */
  readonly url: string;
  readonly summary: string;
  /** Provider-supplied ISO date-time, if known; do not invent missing dates. */
  readonly publishedAt?: string;
}
