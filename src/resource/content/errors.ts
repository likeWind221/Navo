export type ContentErrorCode = "empty_content" | "pdf_parse_failed" | "read_failed" | "page_limit_exceeded"
  | "content_limit_exceeded" | "input_limit_exceeded" | "cancelled" | "timeout";

export class ContentError extends Error {
  constructor(readonly code: ContentErrorCode) {
    super(code);
  }
}

export const shutdownReason = Symbol("content-shutdown");

export function contentFailure(error: unknown, signal: AbortSignal): ContentError {
  if (signal.aborted) return new ContentError(signal.reason?.name === "TimeoutError" ? "timeout" : "cancelled");
  return error instanceof ContentError ? error : new ContentError("read_failed");
}
