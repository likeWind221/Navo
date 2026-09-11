import type { SessionId } from "../../../brand/ids.js";
import type { JsonObject } from "../../../llm/types.js";
import { ToolExecutionError } from "../../errors.js";
import type { ToolDefinition } from "../../types.js";
import type { FileExecutionWorld } from "../file/path.js";
import { ShellError } from "./errors.js";
import { runShellCommand } from "./execution.js";
import { resolveShellProfile } from "./profile.js";
import {
  SHELL_LIMITS,
  shellToolSchema,
  type ShellExecSpec,
  type ShellKind,
  type ShellResult,
} from "./types.js";

export interface ShellToolConfig {
  readonly resolveWorld: (sessionId: SessionId) => FileExecutionWorld | Promise<FileExecutionWorld>;
  readonly kind?: ShellKind;
  readonly path?: string;
}

export function createShellTool(config: ShellToolConfig): ToolDefinition {
  const profile = resolveShellProfile(config);
  return {
    ...shellToolSchema(profile.name, profile.pathStyle),
    async execute(args, execution) {
      try {
        const spec = validateShellRequest(args);
        if (!execution.sessionId) {
          throw new ShellError("session-required", "Shell requires a Session.");
        }
        const world = await config.resolveWorld(execution.sessionId);
        const result = await runShellCommand(world, spec, execution.signal, profile);
        return { content: formatShellResult(result) };
      } catch (error: unknown) {
        const failure = classifyShellError(error, execution.signal);
        throw new ToolExecutionError(failure.message, failure.modelMessage, { cause: failure });
      }
    },
  };
}

function validateShellRequest(args: JsonObject): ShellExecSpec {
  if (Object.keys(args).some((key) => key !== "command" && key !== "timeoutMs")
    || typeof args.command !== "string" || args.command.trim().length === 0) {
    throw new ShellError("invalid-request", "Shell command must be a non-empty string without extra fields.");
  }
  const requested = args.timeoutMs;
  const timeoutMs = requested === undefined ? SHELL_LIMITS.defaultTimeoutMs : requested;
  if (typeof timeoutMs !== "number" || !Number.isSafeInteger(timeoutMs)
    || timeoutMs < 1 || timeoutMs > SHELL_LIMITS.maxTimeoutMs) {
    throw new ShellError("invalid-request", "Shell timeoutMs must be an integer within the supported range.");
  }
  return { command: args.command, timeoutMs };
}

function formatShellResult(result: ShellResult): string {
  let body = result.stdout.text;
  if (result.stderr.text.length > 0) {
    if (body.length > 0 && !body.endsWith("\n")) body += "\n";
    body += `[stderr]\n${result.stderr.text}`;
  }
  if (result.stdout.truncated || result.stderr.truncated) {
    if (body.length > 0 && !body.endsWith("\n")) body += "\n";
    body += `[output truncated; each stream keeps its last ${SHELL_LIMITS.maxOutputBytes} bytes]`;
  }
  if (body.length === 0) body = "(no output)";

  const markers: string[] = [];
  if (result.timedOut) markers.push(`[timed out after ${result.timeoutMs}ms]`);
  if (result.signal !== null) {
    markers.push(`[killed by signal: ${result.signal}]`);
  } else if (result.exitCode !== null && result.exitCode !== 0) {
    markers.push(`[exit code: ${result.exitCode}]`);
  }
  if (markers.length === 0) return body;
  if (!body.endsWith("\n")) body += "\n";
  return body + markers.join("\n");
}

function classifyShellError(error: unknown, signal: AbortSignal): ShellError {
  if (signal.aborted) return new ShellError("aborted", "Shell command was cancelled.", { cause: error });
  if (error instanceof ShellError) return error;
  const message = error instanceof Error ? error.message : String(error);
  return new ShellError("execution-failed", message, { cause: error });
}
