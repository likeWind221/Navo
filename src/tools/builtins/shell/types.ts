import type { ToolSchema } from "../../../llm/types.js";

export type ShellKind = "powershell" | "bash";

export type ShellPathStyle = "windows" | "posix";

export interface ShellRequest {
  readonly command: string;
  readonly timeoutMs?: number;
}

export interface ShellExecSpec {
  readonly command: string;
  readonly timeoutMs: number;
}

export interface ShellStreamOutput {
  readonly text: string;
  readonly truncated: boolean;
}

export interface ShellResult {
  readonly exitCode: number | null;
  readonly signal: string | null;
  readonly timedOut: boolean;
  readonly aborted: boolean;
  readonly timeoutMs: number;
  readonly stdout: ShellStreamOutput;
  readonly stderr: ShellStreamOutput;
}

export const SHELL_LIMITS = Object.freeze({
  defaultTimeoutMs: 120_000,
  maxTimeoutMs: 600_000,
  maxOutputBytes: 64_000,
  graceMs: 3_000,
});

export function shellToolSchema(
  name: string,
  pathStyle: ShellPathStyle,
): ToolSchema {
  const paths = pathStyle === "windows"
    ? "Use native Windows paths (`C:\\...`) and read environment variables with `$env:NAME`."
    : "Use POSIX paths and read environment variables with `$NAME`.";
  return {
    name: "shell",
    description: `Execute a ${name} command and return its stdout, stderr and exit status. `
      + "Every call starts a fresh process, so no working directory, variable or function persists between calls. "
      + "The command runs in the current Session execution world, where relative paths resolve; "
      + "use it to list, search and inspect files (for example with `rg`, `ls` or `find`). "
      + `${paths} `
      + "A non-zero exit is reported as `[exit code: N]` and is not a tool error. "
      + `Each stream keeps its last ${SHELL_LIMITS.maxOutputBytes} bytes and reports truncation.`,
    parameters: {
      type: "object",
      properties: {
        command: {
          type: "string",
          description: "Command line to run in the current Session execution world.",
        },
        timeoutMs: {
          type: "integer",
          description: `Optional timeout in milliseconds, 1..${SHELL_LIMITS.maxTimeoutMs}, default ${SHELL_LIMITS.defaultTimeoutMs}. `
            + "On expiry the process tree is killed and the result is marked as timed out.",
        },
      },
      required: ["command"],
      additionalProperties: false,
    },
  };
}
