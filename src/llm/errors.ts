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
