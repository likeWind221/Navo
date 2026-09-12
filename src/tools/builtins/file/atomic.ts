import { randomUUID } from "node:crypto";
import { link, open, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";

import { FileError } from "./errors.js";
import { fileVersionFromStats, type FileVersion } from "./version.js";

const WRITE_CHUNK_BYTES = 64 * 1024;

export type AtomicCommit =
  | { readonly kind: "replace"; readonly beforeCommit?: () => Promise<void> }
  | { readonly kind: "create-if-absent" };

const REPLACE: AtomicCommit = Object.freeze({ kind: "replace" });

/** Publish complete bytes through a sibling staging file; publication is the commit point. */
export async function atomicWriteFile(
  targetPath: string,
  bytes: Uint8Array,
  mode: number,
  signal: AbortSignal,
  tempLabel: "edit" | "write" | "fetch",
  commit: AtomicCommit = REPLACE,
): Promise<FileVersion> {
  let tempPath: string | undefined;
  let handle: FileHandle | undefined;
  let committed = false;

  try {
    signal.throwIfAborted();
    tempPath = join(
      dirname(targetPath),
      `.skillworld-${tempLabel}-${process.pid}-${randomUUID()}.tmp`,
    );
    handle = await open(tempPath, "wx", 0o600);
    await writeAll(handle, bytes, signal);
    signal.throwIfAborted();
    await handle.chmod(mode & 0o7777);
    await handle.sync();
    const stagedVersion = fileVersionFromStats(await handle.stat({ bigint: true }));
    signal.throwIfAborted();
    await handle.close();
    handle = undefined;

    signal.throwIfAborted();
    if (commit.kind === "create-if-absent") {
      try {
        await link(tempPath, targetPath);
      } catch (error: unknown) {
        if (isCode(error, "EEXIST")) {
          throw new FileError(
            "not-observed",
            "Create target appeared before publication.",
            { cause: error },
          );
        }
        throw error;
      }
      committed = true;
      try { await unlink(tempPath); } catch {}
      tempPath = undefined;
      return stagedVersion;
    }

    await commit.beforeCommit?.();
    signal.throwIfAborted();
    await rename(tempPath, targetPath);
    committed = true;
    return stagedVersion;
  } finally {
    if (handle) {
      try { await handle.close(); } catch {}
    }
    if (!committed && tempPath) {
      try { await unlink(tempPath); } catch {}
    }
  }
}

async function writeAll(
  handle: FileHandle,
  bytes: Uint8Array,
  signal: AbortSignal,
): Promise<void> {
  let offset = 0;
  while (offset < bytes.byteLength) {
    signal.throwIfAborted();
    const length = Math.min(WRITE_CHUNK_BYTES, bytes.byteLength - offset);
    const result = await handle.write(bytes, offset, length, null);
    signal.throwIfAborted();
    if (result.bytesWritten < 1) {
      throw new FileError("io-failed", "Atomic staging write made no progress.");
    }
    offset += result.bytesWritten;
  }
}

function isCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object" && "code" in error && error.code === code;
}
