export type EmbeddingErrorCode =
  | "invalid-config"
  | "invalid-input"
  | "request-failed"
  | "authentication-failed"
  | "model-unavailable"
  | "input-too-large"
  | "invalid-response";

export class EmbeddingError extends Error {
  constructor(readonly code: EmbeddingErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "EmbeddingError";
  }
}
