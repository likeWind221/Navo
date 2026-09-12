import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";

import type { SessionId } from "../../../brand/ids.js";
import { atomicWriteFile } from "../file/atomic.js";
import type { FileEnvironment } from "../file/path.js";
import { resolveFileTarget } from "../file/path.js";
import { FILE_LIMITS } from "../file/types.js";
import { FetchError } from "./errors.js";

export interface FetchSpillConfig {
  readonly resolveFileEnvironment: (
    sessionId: SessionId,
  ) => FileEnvironment | Promise<FileEnvironment>;
}

export function createFetchSpillPath(): string {
  return join("web", `fetch-${randomUUID()}.md`);
}

/** Persist one already-complete Fetch document without going through the model-facing Write Tool. */
export async function spillFetchDocument(
  config: FetchSpillConfig,
  sessionId: SessionId,
  relativePath: string,
  document: string,
  signal: AbortSignal,
): Promise<void> {
  const bytes = Buffer.from(document, "utf8");
  if (bytes.byteLength > FILE_LIMITS.maxFileBytes) {
    throw new FetchError(
      "response-too-large",
      "Fetched document exceeds the file spill byte limit.",
    );
  }

  try {
    signal.throwIfAborted();
    const environment = await config.resolveFileEnvironment(sessionId);
    signal.throwIfAborted();
    await mkdir(join(environment.cwd, "web"), { recursive: true });
    signal.throwIfAborted();

    const target = await resolveFileTarget(environment, relativePath);
    if (target.exists) {
      throw new FetchError("spill-failed", "Generated Fetch spill target already exists.");
    }
    await atomicWriteFile(
      target.path,
      bytes,
      0o666 & ~process.umask(),
      signal,
      "fetch",
    );
  } catch (error: unknown) {
    if (signal.aborted) {
      throw new FetchError("aborted", "Fetch spill cancelled.", { cause: error });
    }
    if (error instanceof FetchError) throw error;
    throw new FetchError(
      "spill-failed",
      "Fetched document could not be saved to the file environment.",
      { cause: error },
    );
  }
}
