import { stat } from "node:fs/promises";
import type { BigIntStats } from "node:fs";

import { FileError } from "./errors.js";

declare const fileVersionBrand: unique symbol;
export type FileVersion = string & { readonly [fileVersionBrand]: true };

export type FileProbe =
  | { readonly kind: "absent" }
  | { readonly kind: "other" }
  | {
      readonly kind: "file";
      readonly version: FileVersion;
      readonly mode: number;
      readonly size: bigint;
    };

/** Local freshness token aligned with DSH's high-resolution stat identity model. */
export function fileVersionFromStats(info: BigIntStats): FileVersion {
  return `${info.dev}:${info.ino}:${info.size}:${info.mtimeNs}` as FileVersion;
}

export async function probeFile(path: string): Promise<FileProbe> {
  try {
    const info = await stat(path, { bigint: true });
    if (!info.isFile()) return { kind: "other" };
    return {
      kind: "file",
      version: fileVersionFromStats(info),
      mode: Number(info.mode & 0o7777n),
      size: info.size,
    };
  } catch (error: unknown) {
    if (isCode(error, "ENOENT")) return { kind: "absent" };
    throw error;
  }
}

/** Reject when a previously observed file is no longer exactly that local version. */
export async function assertFileVersion(
  path: string,
  expected: FileVersion,
): Promise<void> {
  const current = await probeFile(path);
  if (current.kind !== "file" || current.version !== expected) {
    throw new FileError(
      "stale-version",
      "File changed after the Session observed it.",
    );
  }
}

function isCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object"
    && "code" in error && error.code === code;
}
