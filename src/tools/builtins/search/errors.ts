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
  | "provider-unavailable"
  | "invalid-request"
  | "request-failed"
  | "invalid-response"
  | "response-too-large"
  | "timeout"
  | "aborted";

const MODEL_MESSAGES: Readonly<Record<SearchErrorCode, string>> = Object.freeze({
  "invalid-config": "Search configuration is invalid.",
  "invalid-adapter": "Search adapter configuration is invalid.",
  "provider-unavailable": "No search provider is available.",
  "invalid-request": "Search parameters are invalid.",
  "request-failed": "The search request failed.",
  "invalid-response": "The search provider returned an invalid response.",
  "response-too-large": "The search response exceeded the size limit.",
  timeout: "The search request timed out.",
  aborted: "The search request was cancelled.",
});
