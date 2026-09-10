import type { DisplayFailure } from "../../shared/content.js";
import { DISPLAY_SUMMARY_MAX_CHARS } from "../../shared/content.js";

export type CommandErrorCode = "invalid-command" | "unknown-command" | "invalid-args" | "command-failed";

export class CommandError extends Error {
  constructor(
    readonly code: CommandErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "CommandError";
  }
}

export function commandFailure(error: unknown): DisplayFailure {
  if (error instanceof CommandError) return { code: error.code, message: bounded(error.message) };
  if (error instanceof Error) return { code: "command-failed", message: bounded(error.message) };
  return { code: "command-failed", message: "Command failed." };
}

function bounded(value: string): string {
  return value.slice(0, DISPLAY_SUMMARY_MAX_CHARS) || "Command failed.";
}
