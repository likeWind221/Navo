import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

import type { SessionId } from "../../../brand/ids.js";
import { ToolExecutionError } from "../../errors.js";
import type { ToolDefinition } from "../../types.js";
import { FileError } from "./errors.js";
import type { FileObservationStore } from "./observation.js";
import { resolveFileTarget, type FileEnvironment } from "./path.js";
import { buildReadWindow, formatReadResult } from "./read/window.js";
import { FILE_LIMITS, FILE_TOOL_SCHEMAS, type ReadRequest, type ReadResult } from "./types.js";
import { fileVersionFromStats, probeFile, type FileVersion } from "./version.js";

export interface ReadToolConfig {
  readonly resolveFileEnvironment: (
    sessionId: SessionId,
  ) => FileEnvironment | Promise<FileEnvironment>;
  readonly saveResult?: (result: ReadResult, sessionId: SessionId) => void | Promise<void>;
  readonly observations: FileObservationStore;
}

interface VersionedRead {
  readonly result: ReadResult;
  readonly version: FileVersion;
}

export function createReadTool(config: ReadToolConfig): ToolDefinition {
  return {
    ...FILE_TOOL_SCHEMAS.read,
    async execute(args, execution) {
      try {
        execution.signal.throwIfAborted();
        if (!execution.sessionId) throw new FileError("session-required", "Read requires a Session.");
        const sessionId = execution.sessionId;
        const environment = await config.resolveFileEnvironment(sessionId);
        const { result, version } = await readTextFileWithVersion(
          environment,
          args as unknown as ReadRequest,
          execution.signal,
        );
        await config.saveResult?.(result, sessionId);
        execution.signal.throwIfAborted();
        config.observations.observeRead(sessionId, result, version);
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
  return (await readTextFileWithVersion(environment, request, signal)).result;
}

export async function readTextFileWithVersion(
  environment: FileEnvironment,
  request: ReadRequest,
  signal: AbortSignal,
): Promise<VersionedRead> {
  let handle: FileHandle | undefined;
  try {
    signal.throwIfAborted();
    const { startLine, maxLines } = validateReadRequest(request);
    const target = await resolveFileTarget(environment, request.path);
    signal.throwIfAborted();
    const initial = await probeFile(target.path);
    if (initial.kind === "absent") throw new FileError("not-found", "Read target is missing.");
    if (initial.kind === "other") throw new FileError("not-a-file", "Read target is not a regular file.");
    handle = await open(target.path, "r");
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new FileError("not-a-file", "Opened target is not a regular file.");
    const version = fileVersionFromStats(before);
    const size = before.size < BigInt(FILE_LIMITS.readStreamMinBytes)
      ? Number(before.size)
      : FILE_LIMITS.readStreamMinBytes;
    const result = await buildReadWindow(
      readChunks(handle, size, signal), target.path, startLine, maxLines, signal,
    );
    const after = fileVersionFromStats(await handle.stat({ bigint: true }));
    const current = await probeFile(target.path);
    if (after !== version || current.kind !== "file" || current.version !== version) {
      throw new FileError("stale-version", "Read target changed while it was being observed.");
    }
    return { result, version };
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
  const detail = error instanceof Error ? error.message : String(error);
  return new FileError("io-failed", `Read failed: ${detail}`, { cause: error });
}
