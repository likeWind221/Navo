export type LLMServiceErrorCode =
  | "adapter-already-registered"
  | "adapter-not-found"
  | "aborted"
  | "stream-failed";

/** LLM registration, routing, cancellation, or stream boundary failure. */
export class LLMServiceError extends Error {
  readonly code: LLMServiceErrorCode;

  constructor(
    code: LLMServiceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "LLMServiceError";
    this.code = code;
  }
}

export function isLLMServiceError(error: unknown): error is LLMServiceError {
  return error instanceof LLMServiceError;
}

/** Stable provider failure facts that adapters may expose across the LLM seam. */
export class LLMProviderError extends Error {
  readonly code: string;
  readonly status?: number;
  readonly retryAfterMs?: number;

  constructor(
    code: string,
    message: string,
    options: ErrorOptions & {
      readonly status?: number;
      readonly retryAfterMs?: number;
    } = {},
  ) {
    super(message, options);
    this.name = "LLMProviderError";
    this.code = code;
    if (options.status !== undefined) this.status = options.status;
    if (options.retryAfterMs !== undefined) this.retryAfterMs = options.retryAfterMs;
  }
}
