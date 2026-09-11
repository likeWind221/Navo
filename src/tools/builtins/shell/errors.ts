export class ShellError extends Error {
  readonly code: ShellErrorCode;
  readonly modelMessage: string;

  constructor(code: ShellErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ShellError";
    this.code = code;
    this.modelMessage = SHELL_MODEL_MESSAGES[code];
  }
}

export type ShellErrorCode =
  | "invalid-config"
  | "invalid-request"
  | "session-required"
  | "spawn-failed"
  | "execution-failed"
  | "aborted";

const SHELL_MODEL_MESSAGES: Readonly<Record<ShellErrorCode, string>> = Object.freeze({
  "invalid-config": "The shell tool is not configured for this host.",
  "invalid-request": "Shell tool parameters are invalid. Provide a non-empty command and a timeout within the supported range.",
  "session-required": "Shell tools require an active Session.",
  "spawn-failed": "The command could not be started in the current Session execution world.",
  "execution-failed": "The command could not be completed in the current Session execution world.",
  aborted: "The command was cancelled.",
});
