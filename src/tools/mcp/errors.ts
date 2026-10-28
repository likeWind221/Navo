export type McpDirectoryErrorCode = "directory-invalid" | "stopped";

export class McpDirectoryError extends Error {
  readonly code: McpDirectoryErrorCode;

  constructor(code: McpDirectoryErrorCode, message: string) {
    super(message);
    this.name = "McpDirectoryError";
    this.code = code;
  }
}
