import { open } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";

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
  type EditRequest,
  type FileMutationResult,
} from "./types.js";
import {
  assertFileVersion,
  fileVersionFromStats,
  probeFile,
  type FileVersion,
} from "./version.js";

export interface EditToolConfig {
  readonly resolveFileEnvironment: (
    sessionId: SessionId,
  ) => FileEnvironment | Promise<FileEnvironment>;
  /** Omit only for bare/internal use; ToolsPlugin always injects the safety policy. */
  readonly observations?: FileObservationStore;
  readonly mutations?: FileMutationCoordinator;
}

interface EditCommit {
  readonly result: FileMutationResult;
  readonly version: FileVersion;
}

export function createEditTool(config: EditToolConfig): ToolDefinition {
  const mutations = config.mutations ?? new FileMutationCoordinator();
  return {
    ...FILE_TOOL_SCHEMAS.edit,
    async execute(args, execution) {
      try {
        execution.signal.throwIfAborted();
        if (!execution.sessionId) throw new FileError("session-required", "Edit requires a Session.");
        const environment = await config.resolveFileEnvironment(execution.sessionId);
        const request = args as unknown as EditRequest;
        const result = config.observations === undefined
          ? await editTextFile(environment, request, execution.signal)
          : await editObservedTextFile(
              environment, request, execution.sessionId, config.observations,
              execution.signal, mutations,
            );
        return { content: formatEditResult(result) };
      } catch (error: unknown) {
        const failure = classifyEditError(error, execution.signal);
        throw new ToolExecutionError(failure.message, failure.modelMessage, { cause: failure });
      }
    },
  };
}

/** Unguarded core helper retained for focused literal-edit tests; model-facing Edit is guarded. */
export async function editTextFile(
  environment: FileEnvironment,
  request: EditRequest,
  signal: AbortSignal,
): Promise<FileMutationResult> {
  try {
    signal.throwIfAborted();
    validateEditRequest(request);
    const target = await resolveFileTarget(environment, request.path);
    if (!target.exists) throw new FileError("not-found", "Edit target does not exist.");
    return (await editResolvedFile(target.path, request, signal)).result;
  } catch (error: unknown) {
    throw classifyEditError(error, signal);
  }
}

async function editObservedTextFile(
  environment: FileEnvironment,
  request: EditRequest,
  sessionId: SessionId,
  observations: FileObservationStore,
  signal: AbortSignal,
  mutations: FileMutationCoordinator,
): Promise<FileMutationResult> {
  validateEditRequest(request);
  const target = await resolveFileTarget(environment, request.path);
  if (!target.exists) throw new FileError("not-found", "Edit target does not exist.");
  return mutations.runTarget(target.path, async () => {
    const expected = observations.getObservedVersion(sessionId, target.path);
    if (expected === undefined) {
      throw new FileError("not-observed", "Edit target was not observed in this Session.");
    }
    const current = await probeFile(target.path);
    if (current.kind !== "file" || current.version !== expected) {
      observations.forget(sessionId, target.path);
      throw new FileError("stale-version", "Observed edit target changed before mutation.");
    }
    try {
      const committed = await editResolvedFile(target.path, request, signal, expected);
      observations.observeWhole(sessionId, target.path, committed.version);
      return committed.result;
    } catch (error: unknown) {
      if (error instanceof FileError && error.code === "stale-version") {
        observations.forget(sessionId, target.path);
      }
      throw error;
    }
  });
}

async function editResolvedFile(
  path: string,
  request: EditRequest,
  signal: AbortSignal,
  expected?: FileVersion,
): Promise<EditCommit> {
  const source = await readEditSource(path, signal);
  if (expected !== undefined && source.version !== expected) {
    throw new FileError("stale-version", "Edit source changed before it could be read.");
  }
  const content = decodeText(source.bytes);
  const edited = replaceUnique(content, request.oldText, request.newText);
  const encoded = Buffer.from(edited, "utf8");
  if (encoded.byteLength > FILE_LIMITS.maxFileBytes) {
    throw new FileError("file-too-large", "Edited file exceeds the file byte limit.");
  }

  const version = await atomicWriteFile(
    path,
    encoded,
    source.mode,
    signal,
    "edit",
    expected === undefined
      ? undefined
      : { kind: "replace", beforeCommit: () => assertFileVersion(path, expected) },
  );
  return {
    result: { path, operation: "edit", bytesWritten: encoded.byteLength },
    version,
  };
}

async function readEditSource(
  path: string,
  signal: AbortSignal,
): Promise<{ readonly bytes: Uint8Array; readonly mode: number; readonly version: FileVersion }> {
  let handle: FileHandle | undefined;
  try {
    signal.throwIfAborted();
    handle = await open(path, "r");
    const before = await handle.stat({ bigint: true });
    if (!before.isFile()) throw new FileError("not-a-file", "Edit target is not a regular file.");
    if (before.size > BigInt(FILE_LIMITS.maxFileBytes)) {
      throw new FileError("file-too-large", "Edit target exceeds the file byte limit.");
    }
    const version = fileVersionFromStats(before);
    const bytes = Buffer.allocUnsafe(FILE_LIMITS.maxFileBytes + 1);
    let total = 0;
    while (total < bytes.length) {
      signal.throwIfAborted();
      const length = Math.min(64 * 1024, bytes.length - total);
      const read = await handle.read(bytes, total, length, null);
      signal.throwIfAborted();
      if (read.bytesRead === 0) break;
      total += read.bytesRead;
    }
    if (total > FILE_LIMITS.maxFileBytes) {
      throw new FileError("file-too-large", "Edit target exceeds the file byte limit.");
    }
    if (fileVersionFromStats(await handle.stat({ bigint: true })) !== version) {
      throw new FileError("stale-version", "Edit target changed while it was being read.");
    }
    return { bytes: bytes.subarray(0, total), mode: Number(before.mode & 0o7777n), version };
  } finally {
    await handle?.close();
  }
}

function validateEditRequest(request: EditRequest): void {
  if (!request || typeof request !== "object"
    || Object.keys(request).some((key) => !["path", "oldText", "newText"].includes(key))
    || typeof request.path !== "string" || request.path.length === 0
    || request.path.length > FILE_LIMITS.maxPathCharacters || request.path.includes("\0")
    || typeof request.oldText !== "string" || request.oldText.length === 0
    || typeof request.newText !== "string") {
    throw new FileError("invalid-request", "Invalid edit arguments.");
  }
  validateRequestText(request.oldText);
  validateRequestText(request.newText);
  if (request.oldText === request.newText) {
    throw new FileError("invalid-request", "Edit replacement must change the matched text.");
  }
}

function validateRequestText(text: string): void {
  if (text.includes("\0") || !text.isWellFormed()) {
    throw new FileError("invalid-text", "Edit text contains NUL or an unpaired surrogate.");
  }
  if (Buffer.byteLength(text, "utf8") > FILE_LIMITS.maxFileBytes) {
    throw new FileError("file-too-large", "Edit text exceeds the file byte limit.");
  }
}

function decodeText(raw: Uint8Array): string {
  if (raw.includes(0)) throw new FileError("invalid-text", "Edit target contains NUL.");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch (error: unknown) {
    throw new FileError("invalid-text", "Edit target is not valid UTF-8.", { cause: error });
  }
}

function replaceUnique(content: string, oldText: string, newText: string): string {
  const first = content.indexOf(oldText);
  if (first === -1) throw new FileError("edit-not-found", "oldText was not found.");
  if (content.indexOf(oldText, first + 1) !== -1) {
    throw new FileError("edit-not-unique", "oldText matched more than once.");
  }
  return content.slice(0, first) + newText + content.slice(first + oldText.length);
}

function formatEditResult(result: FileMutationResult): string {
  return `Edited ${JSON.stringify(result.path)} (${result.bytesWritten} bytes).`;
}

function classifyEditError(error: unknown, signal: AbortSignal): FileError {
  if (signal.aborted) return new FileError("aborted", "Edit cancelled.", { cause: error });
  if (error instanceof FileError) return error;
  if (isCode(error, "ENOENT")) return new FileError("not-found", "Edit target is missing.", { cause: error });
  if (isCode(error, "ENOTDIR")) {
    return new FileError("not-a-directory", "Edit target parent is not a directory.", { cause: error });
  }
  if (isCode(error, "EACCES") || isCode(error, "EPERM") || isCode(error, "EROFS")) {
    return new FileError("permission-denied", "Edit access denied.", { cause: error });
  }
  return new FileError("io-failed", "Edit failed.", { cause: error });
}

function isCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === code;
}
