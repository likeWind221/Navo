import { randomUUID } from "node:crypto";
import { open, rename, unlink } from "node:fs/promises";
import type { FileHandle } from "node:fs/promises";
import { dirname, join } from "node:path";

import { FileError } from "./errors.js";

const WRITE_CHUNK_BYTES = 64 * 1024;

/** Publish complete bytes through a sibling staging file; rename is the commit point. */
export async function atomicWriteFile(
  targetPath: string,
  bytes: Uint8Array,
  mode: number,
  signal: AbortSignal,
  tempLabel: "edit" | "write" | "fetch",
): Promise<void> {
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
    signal.throwIfAborted();
    await handle.close();
    handle = undefined;

    signal.throwIfAborted();
    await rename(tempPath, targetPath);
    committed = true;
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
