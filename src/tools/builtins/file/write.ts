import type { SessionId } from "../../../brand/ids.js";
import { ToolExecutionError } from "../../errors.js";
import type { ToolDefinition } from "../../types.js";
import { atomicWriteFile } from "./atomic.js";
import { FileError } from "./errors.js";
import { FileMutationCoordinator } from "./lock.js";
import type { FileObservationStore } from "./observation.js";
import { resolveFileTarget, type FileEnvironment } from "./path.js";
import {
  FILE_LIMITS,
  FILE_TOOL_SCHEMAS,
  type FileMutationResult,
  type WriteRequest,
} from "./types.js";
import { assertFileVersion, probeFile } from "./version.js";

export interface WriteToolConfig {
  readonly resolveFileEnvironment: (
    sessionId: SessionId,
  ) => FileEnvironment | Promise<FileEnvironment>;
  readonly observations: FileObservationStore;
  readonly mutations?: FileMutationCoordinator;
}

export function createWriteTool(config: WriteToolConfig): ToolDefinition {
  const mutations = config.mutations ?? new FileMutationCoordinator();
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
          mutations,
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
  mutations = new FileMutationCoordinator(),
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
    return await mutations.runTarget(target.path, async () => {
      const expected = observations.getObservedVersion(sessionId, target.path);
      const current = await probeFile(target.path);
      if (current.kind === "other") {
        throw new FileError("not-a-file", "Write target is not a regular file.");
      }

      if (expected !== undefined) {
        if (current.kind !== "file" || current.version !== expected) {
          observations.forget(sessionId, target.path);
          throw new FileError("stale-version", "Observed write target changed before mutation.");
        }
        try {
          const version = await atomicWriteFile(
            target.path,
            encoded,
            current.mode,
            signal,
            "write",
            {
              kind: "replace",
              beforeCommit: () => assertFileVersion(target.path, expected),
            },
          );
          observations.observeWhole(sessionId, target.path, version);
          return {
            path: target.path,
            operation: "overwrite" as const,
            bytesWritten: encoded.byteLength,
          };
        } catch (error: unknown) {
          if (error instanceof FileError && error.code === "stale-version") {
            observations.forget(sessionId, target.path);
          }
          throw error;
        }
      }

      if (current.kind === "file") {
        throw new FileError("not-observed", "Existing write target was not observed in this Session.");
      }
      const version = await atomicWriteFile(
        target.path,
        encoded,
        0o666 & ~process.umask(),
        signal,
        "write",
        { kind: "create-if-absent" },
      );
      observations.observeWhole(sessionId, target.path, version);
      return {
        path: target.path,
        operation: "create" as const,
        bytesWritten: encoded.byteLength,
      };
    });
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
