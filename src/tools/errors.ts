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

/** Tool-body failure with a separate message explicitly approved for the model. */
export class ToolExecutionError extends Error {
  readonly modelMessage: string;

  constructor(
    message: string,
    modelMessage: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ToolExecutionError";
    this.modelMessage = modelMessage;
  }
}

export function isToolExecutionError(
  error: unknown,
): error is ToolExecutionError {
  return error instanceof ToolExecutionError;
}
