import { open, stat } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

import type { SessionId } from "../../../brand/ids.js";
import { ToolExecutionError } from "../../errors.js";
import type { ToolDefinition } from "../../types.js";
import { FileError } from "./errors.js";
import type { FileObservationStore } from "./observation.js";
import { resolveFileTarget, type FileEnvironment } from "./path.js";
import { buildReadWindow, formatReadResult } from "./read/window.js";
import { FILE_LIMITS, FILE_TOOL_SCHEMAS, type ReadRequest, type ReadResult } from "./types.js";

export interface ReadToolConfig {
  readonly resolveFileEnvironment: (
    sessionId: SessionId,
  ) => FileEnvironment | Promise<FileEnvironment>;
  readonly saveResult: (result: ReadResult, sessionId: SessionId) => void | Promise<void>;
  readonly observations: FileObservationStore;
}

export function createReadTool(config: ReadToolConfig): ToolDefinition {
  return {
    ...FILE_TOOL_SCHEMAS.read,
    async execute(args, execution) {
      try {
        execution.signal.throwIfAborted();
        if (!execution.sessionId) throw new FileError("session-required", "Read requires a Session.");
        const environment = await config.resolveFileEnvironment(execution.sessionId);
        const result = await readTextFile(
          environment,
          args as unknown as ReadRequest,
          execution.signal,
        );
        await config.saveResult(result, execution.sessionId);
        execution.signal.throwIfAborted();
        config.observations.observe(execution.sessionId, result.path);
        return { content: formatReadResult(result) };
      } catch (error) {
        const failure = classifyReadError(error, execution.signal);
        throw new ToolExecutionError(failure.message, failure.modelMessage, { cause: failure });
      }
    },
  };
}

export async function readTextFile(
  environment: FileEnvironment,
  request: ReadRequest,
  signal: AbortSignal,
): Promise<ReadResult> {
  let handle: FileHandle | undefined;
  try {
    signal.throwIfAborted();
    const { startLine, maxLines } = validateReadRequest(request);
    const target = await resolveFileTarget(environment, request.path);
    signal.throwIfAborted();
    if (!(await stat(target.path)).isFile()) {
      throw new FileError("not-a-file", "Read target is not a regular file.");
    }
    signal.throwIfAborted();
    handle = await open(target.path, "r");
    const info = await handle.stat();
    if (!info.isFile()) throw new FileError("not-a-file", "Opened target is not a regular file.");
    return await buildReadWindow(
      readChunks(handle, info.size, signal), target.path, startLine, maxLines, signal,
    );
  } catch (error) {
    throw classifyReadError(error, signal);
  } finally {
    await handle?.close();
  }
}

async function* readChunks(
  handle: FileHandle,
  size: number,
  signal: AbortSignal,
): AsyncGenerator<Uint8Array> {
  const buffer = Buffer.alloc(size < FILE_LIMITS.readStreamMinBytes
    ? Math.max(1, size + 1)
    : 64 * 1024);
  while (true) {
    signal.throwIfAborted();
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, null);
    signal.throwIfAborted();
    if (bytesRead === 0) return;
    yield buffer.subarray(0, bytesRead);
  }
}

function validateReadRequest(request: ReadRequest): { startLine: number; maxLines: number } {
  if (!request || typeof request !== "object"
    || Object.keys(request).some((key) => !["path", "startLine", "maxLines"].includes(key))
    || typeof request.path !== "string" || request.path.length === 0
    || request.path.length > FILE_LIMITS.maxPathCharacters || request.path.includes("\0")) {
    throw new FileError("invalid-request", "Invalid read arguments.");
  }
  const startLine = request.startLine ?? 1;
  const maxLines = request.maxLines ?? FILE_LIMITS.defaultReadLines;
  if (!Number.isSafeInteger(startLine) || startLine < 1
    || !Number.isSafeInteger(maxLines) || maxLines < 1 || maxLines > FILE_LIMITS.maxReadLines
    || request.startLine === null || request.maxLines === null) {
    throw new FileError("invalid-request", "Invalid read line window.");
  }
  return { startLine, maxLines };
}

function classifyReadError(error: unknown, signal: AbortSignal): FileError {
  if (signal.aborted) return new FileError("aborted", "Read cancelled.", { cause: error });
  if (error instanceof FileError) return error;
  const code = error && typeof error === "object" && "code" in error ? error.code : undefined;
  if (code === "ENOENT") return new FileError("not-found", "Read target is missing.", { cause: error });
  if (code === "EACCES" || code === "EPERM") {
    return new FileError("permission-denied", "Read access denied.", { cause: error });
  }
  if (code === "ENOTDIR") return new FileError("not-a-directory", "Invalid parent directory.", { cause: error });
  return new FileError("io-failed", "Read failed.", { cause: error });
}
