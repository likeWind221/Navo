export type ToolServiceErrorCode =
  | "tool-already-registered"
  | "invalid-tool-definition";

/** Tool registration or definition failure thrown at the plugin boundary. */
export class ToolServiceError extends Error {
  readonly code: ToolServiceErrorCode;

  constructor(
    code: ToolServiceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ToolServiceError";
    this.code = code;
  }
}

export function isToolServiceError(error: unknown): error is ToolServiceError {
  return error instanceof ToolServiceError;
}
