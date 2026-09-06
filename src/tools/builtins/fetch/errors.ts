/** Throwable Fetch failures keep diagnostics separate from fixed model text. */
export class FetchError extends Error {
  readonly code: FetchErrorCode;
  readonly modelMessage: string;

  constructor(code: FetchErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FetchError";
    this.code = code;
    this.modelMessage = MODEL_MESSAGES[code];
  }
}

export type FetchErrorCode =
  | "invalid-config"
  | "invalid-request"
  | "invalid-url"
  | "blocked-url"
  | "dns-failed"
  | "network-failed"
  | "redirect-blocked"
  | "response-too-large"
  | "conversion-failed"
  | "unsupported-content-type"
  | "unsupported-charset"
  | "invalid-response"
  | "timeout"
  | "aborted";

const MODEL_MESSAGES: Readonly<Record<FetchErrorCode, string>> = Object.freeze({
  "invalid-config": "Web fetch configuration is invalid.",
  "invalid-request": "Web fetch parameters are invalid.",
  "invalid-url": "The requested URL is invalid or unsupported.",
  "blocked-url": "The requested URL is not allowed by network policy.",
  "dns-failed": "The URL hostname could not be resolved safely.",
  "network-failed": "The web fetch request failed.",
  "redirect-blocked": "The web fetch redirect was not allowed.",
  "response-too-large": "The web response is too large to return as a complete document.",
  "conversion-failed": "The web response could not be converted safely.",
  "unsupported-content-type": "The web response type is not supported.",
  "unsupported-charset": "The web response character encoding is not supported.",
  "invalid-response": "The web fetch provider returned an invalid response.",
  timeout: "The web fetch request timed out.",
  aborted: "The web fetch request was cancelled.",
});
