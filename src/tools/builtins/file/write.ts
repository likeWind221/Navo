import { stat } from "node:fs/promises";

import type { SessionId } from "../../../brand/ids.js";
import { ToolExecutionError } from "../../errors.js";
import type { ToolDefinition } from "../../types.js";
import { atomicWriteFile } from "./atomic.js";
import { FileError } from "./errors.js";
import type { FileObservationStore } from "./observation.js";
import { resolveFileTarget, type FileEnvironment } from "./path.js";
import {
  FILE_LIMITS,
  FILE_TOOL_SCHEMAS,
  type FileMutationResult,
  type WriteRequest,
} from "./types.js";

export interface WriteToolConfig {
  readonly resolveFileEnvironment: (
    sessionId: SessionId,
  ) => FileEnvironment | Promise<FileEnvironment>;
  readonly observations: FileObservationStore;
}

export function createWriteTool(config: WriteToolConfig): ToolDefinition {
  return {
    ...FILE_TOOL_SCHEMAS.write,
    async execute(args, execution) {
      try {
        execution.signal.throwIfAborted();
        if (!execution.sessionId) throw new FileError("session-required", "Write requires a Session.");
        const environment = await config.resolveFileEnvironment(execution.sessionId);
        const result = await writeTextFile(
          environment,
          args as unknown as WriteRequest,
          execution.sessionId,
          config.observations,
          execution.signal,
        );
        return { content: formatWriteResult(result) };
      } catch (error: unknown) {
        const failure = classifyWriteError(error, execution.signal);
        throw new ToolExecutionError(failure.message, failure.modelMessage, { cause: failure });
      }
    },
  };
}

export async function writeTextFile(
  environment: FileEnvironment,
  request: WriteRequest,
  sessionId: SessionId,
  observations: FileObservationStore,
  signal: AbortSignal,
): Promise<FileMutationResult> {
  try {
    signal.throwIfAborted();
    validateWriteRequest(request);
    const encoded = Buffer.from(request.content, "utf8");
    if (encoded.byteLength > FILE_LIMITS.maxFileBytes) {
      throw new FileError("file-too-large", "Write content exceeds the file byte limit.");
    }

    const target = await resolveFileTarget(environment, request.path);
    signal.throwIfAborted();

    let operation: "create" | "overwrite";
    let mode: number;
    if (target.exists) {
      const info = await stat(target.path);
      if (!info.isFile()) throw new FileError("not-a-file", "Write target is not a regular file.");
      if (!observations.hasObserved(sessionId, target.path)) {
        throw new FileError("not-observed", "Existing write target was not observed in this Session.");
      }
      operation = "overwrite";
      mode = info.mode & 0o7777;
    } else {
      operation = "create";
      mode = 0o666 & ~process.umask();
    }

    await atomicWriteFile(target.path, encoded, mode, signal, "write");
    observations.observe(sessionId, target.path);
    return {
      path: target.path,
      operation,
      bytesWritten: encoded.byteLength,
    };
  } catch (error: unknown) {
    throw classifyWriteError(error, signal);
  }
}

function validateWriteRequest(request: WriteRequest): void {
  if (!request || typeof request !== "object"
    || Object.keys(request).some((key) => !["path", "content"].includes(key))
    || typeof request.path !== "string" || request.path.length === 0
    || request.path.length > FILE_LIMITS.maxPathCharacters || request.path.includes("\0")
    || typeof request.content !== "string") {
    throw new FileError("invalid-request", "Invalid write arguments.");
  }
  if (request.content.includes("\0") || !request.content.isWellFormed()) {
    throw new FileError("invalid-text", "Write content contains NUL or an unpaired surrogate.");
  }
}

function formatWriteResult(result: FileMutationResult): string {
  const verb = result.operation === "create" ? "Created" : "Overwrote";
  return `${verb} ${JSON.stringify(result.path)} (${result.bytesWritten} bytes).`;
}

function classifyWriteError(error: unknown, signal: AbortSignal): FileError {
  if (signal.aborted) return new FileError("aborted", "Write cancelled.", { cause: error });
  if (error instanceof FileError) return error;
  if (isCode(error, "ENOENT")) return new FileError("not-found", "Write target is missing.", { cause: error });
  if (isCode(error, "ENOTDIR")) {
    return new FileError("not-a-directory", "Write target parent is not a directory.", { cause: error });
  }
  if (isCode(error, "EACCES") || isCode(error, "EPERM") || isCode(error, "EROFS")) {
    return new FileError("permission-denied", "Write access denied.", { cause: error });
  }
  return new FileError("io-failed", "Write failed.", { cause: error });
}

function isCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === code;
}
