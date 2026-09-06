/** Provider-neutral search capability; no host, model, or learning-domain imports. */
export interface SearchAdapter {
  /** Stable registry key. Register only after local configuration is valid. */
  readonly id: string;
  /** Cooperatively honor cancellation; never return provider-specific raw data. */
  search(request: SearchRequest, signal?: AbortSignal): Promise<SearchResult>;
}

/** Trusted application configuration, never part of model tool arguments. */
export interface SearchServiceConfig {
  /** Missing = select the sole registered adapter; no priority or fallback chain. */
  readonly defaultProvider?: string;
  /** Per-operation deadline in milliseconds: 1–300000, default 30000. */
  readonly timeoutMs?: number;
}

/** Idempotent synchronous removal of a registration. */
export type SearchAdapterRegistration = () => void;

export interface SearchRequest {
  readonly query: string;
  /** Integer 1–20; service normalizes omission to 8 and enforces the bound. */
  readonly maxResults?: number;
}

export interface SearchResult {
  /** An empty array is a valid search outcome, not a transport failure. */
  readonly sources: readonly SearchSource[];
  /** Whether the adapter or service omitted/truncated source data. */
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
