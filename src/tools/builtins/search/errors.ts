/** Throwable search errors stay local; this is not a serializable result protocol. */
export class SearchError extends Error {
  readonly code: SearchErrorCode;
  /** Fixed safe text: do not expose message, cause, credentials, or HTTP bodies. */
  readonly modelMessage: string;

  constructor(code: SearchErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "SearchError";
    this.code = code;
    this.modelMessage = MODEL_MESSAGES[code];
  }
}

export type SearchErrorCode =
  | "invalid-config"
  | "invalid-adapter"
  | "adapter-already-registered"
  | "adapter-not-found"
  | "provider-unavailable"
  | "provider-ambiguous"
  | "invalid-request"
  | "request-failed"
  | "invalid-response"
  | "response-too-large"
  | "timeout"
  | "aborted";

const MODEL_MESSAGES: Readonly<Record<SearchErrorCode, string>> = Object.freeze({
  "invalid-config": "Search configuration is invalid.",
  "invalid-adapter": "Search adapter configuration is invalid.",
  "adapter-already-registered": "A search adapter is already registered.",
  "adapter-not-found": "The configured search provider is not registered.",
  "provider-unavailable": "No search provider is available.",
  "provider-ambiguous": "A default search provider must be configured.",
  "invalid-request": "Search parameters are invalid.",
  "request-failed": "The search request failed.",
  "invalid-response": "The search provider returned an invalid response.",
  "response-too-large": "The search response exceeded the size limit.",
  timeout: "The search request timed out.",
  aborted: "The search request was cancelled.",
});
