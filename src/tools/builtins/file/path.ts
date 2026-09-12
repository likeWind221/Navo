import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

import { FileError } from "./errors.js";
import type { FilePath } from "./types.js";

export interface FileEnvironment {
  readonly cwd: string;
}

export interface FileTarget {
  readonly inputPath: FilePath;
  readonly path: string;
  readonly exists: boolean;
}

export async function createFileEnvironment(
  cwd: string,
): Promise<FileEnvironment> {
  if (typeof cwd !== "string" || !cwd || cwd.includes("\0") || !isAbsolute(cwd)) {
    throw new FileError(
      "invalid-config",
      "File environment cwd must be a non-empty absolute path.",
    );
  }

  let canonicalCwd: string;
  try {
    canonicalCwd = await realpath(cwd);
  } catch (error: unknown) {
    throw classifyFileError(error, "File environment cwd could not be resolved.");
  }

  try {
    if (!(await stat(canonicalCwd)).isDirectory()) {
      throw new FileError(
        "not-a-directory",
        "File environment cwd must be a directory.",
      );
    }
  } catch (error: unknown) {
    throw classifyFileError(error, "File environment cwd could not be inspected.");
  }

  return Object.freeze({ cwd: canonicalCwd });
}

export async function resolveFileTarget(
  environment: FileEnvironment,
  inputPath: FilePath,
): Promise<FileTarget> {
  validateFilePath(inputPath);
  const candidate = resolve(environment.cwd, inputPath);

  try {
    return Object.freeze({
      inputPath,
      path: await realpath(candidate),
      exists: true,
    });
  } catch (error: unknown) {
    if (!isCode(error, "ENOENT")) {
      throw classifyFileError(error, "File target could not be resolved.");
    }
  }

  let canonicalParent: string;
  try {
    canonicalParent = await realpath(dirname(candidate));
  } catch (error: unknown) {
    throw classifyFileError(error, "The parent of the file target could not be resolved.");
  }

  return Object.freeze({
    inputPath,
    path: join(canonicalParent, basename(candidate)),
    exists: false,
  });
}

function validateFilePath(value: string): void {
  if (typeof value !== "string" || !value || value.includes("\0")) {
    throw new FileError("invalid-path", "File path must be a non-empty path.");
  }
}

function classifyFileError(error: unknown, message: string): FileError {
  if (error instanceof FileError) return error;
  if (isCode(error, "ENOENT")) return new FileError("not-found", message, { cause: error });
  if (isCode(error, "ENOTDIR")) return new FileError("not-a-directory", message, { cause: error });
  if (isCode(error, "EACCES") || isCode(error, "EPERM")) {
    return new FileError("permission-denied", message, { cause: error });
  }
  return new FileError("io-failed", message, { cause: error });
}

function isCode(error: unknown, code: string): boolean {
  return error !== null && typeof error === "object"
    && "code" in error && error.code === code;
}
