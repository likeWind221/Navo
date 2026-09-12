/** Throwable file errors keep host diagnostics separate from fixed model text. */
export class FileError extends Error {
  readonly code: FileErrorCode;
  readonly modelMessage: string;

  constructor(code: FileErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "FileError";
    this.code = code;
    this.modelMessage = FILE_MODEL_MESSAGES[code];
  }
}

export type FileErrorCode =
  | "invalid-config"
  | "invalid-request"
  | "session-required"
  | "invalid-path"
  | "path-not-allowed"
  | "not-found"
  | "not-observed"
  | "not-a-file"
  | "not-a-directory"
  | "invalid-text"
  | "file-too-large"
  | "output-too-large"
  | "edit-not-found"
  | "edit-not-unique"
  | "permission-denied"
  | "io-failed"
  | "aborted";

const FILE_MODEL_MESSAGES: Readonly<Record<FileErrorCode, string>> = Object.freeze({
  "invalid-config": "File tool configuration is invalid.",
  "invalid-request": "File tool parameters are invalid. Check the scope, required fields and numeric limits.",
  "session-required": "File tools require an active Session.",
  "invalid-path": "Use a valid path in the current Session file environment.",
  "path-not-allowed": "The requested path is not available in the current file environment.",
  "not-found": "The requested file or directory does not exist.",
  "not-observed": "Read the existing file in this Session before replacing it.",
  "not-a-file": "The requested path is not a regular file.",
  "not-a-directory": "The requested search path is not a directory.",
  "invalid-text": "Only valid UTF-8 text without NUL characters is supported.",
  "file-too-large": "The file exceeds the supported UTF-8 byte limit.",
  "output-too-large": "A complete line or result cannot fit the output budget.",
  "edit-not-found": "The exact oldText was not found. Read the file and retry.",
  "edit-not-unique": "The oldText occurs more than once. Include more context to select a unique match.",
  "permission-denied": "The requested file operation is not permitted.",
  "io-failed": "The file operation failed.",
  aborted: "The file operation was cancelled.",
});
