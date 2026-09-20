import { realpath, stat } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { FileError } from "./errors.js";
import type { FilePath } from "./types.js";

export interface FileEnvironment {
  readonly cwd: string;
  readonly workspaceRoot?: string;
  readonly blockedRoots?: readonly string[];
}

export interface FileTarget {
  readonly inputPath: FilePath;
  readonly path: string;
  readonly exists: boolean;
}

export async function createFileEnvironment(
  cwd: string,
  workspaceRoot?: string,
  blockedRoots: readonly string[] = [],
): Promise<FileEnvironment> {
  if (typeof cwd !== "string" || !cwd || cwd.includes("\0") || !isAbsolute(cwd)) {
    throw new FileError(
      "invalid-config",
      "File environment cwd must be a non-empty absolute path.",
    );
  }

  const canonicalCwd = await canonicalDirectory(
    cwd,
    "File environment cwd could not be resolved.",
    "File environment cwd must be a directory.",
  );
  if (workspaceRoot === undefined) {
    if (blockedRoots.length > 0) {
      throw new FileError(
        "invalid-config",
        "File environment blockedRoots require workspaceRoot.",
      );
    }
    return Object.freeze({ cwd: canonicalCwd });
  }
  if (
    typeof workspaceRoot !== "string"
    || !workspaceRoot
    || workspaceRoot.includes("\0")
    || !isAbsolute(workspaceRoot)
  ) {
    throw new FileError(
      "invalid-config",
      "File environment workspaceRoot must be a non-empty absolute path.",
    );
  }

  const canonicalRoot = await canonicalDirectory(
    workspaceRoot,
    "File environment workspaceRoot could not be resolved.",
    "File environment workspaceRoot must be a directory.",
  );
  assertFileContained(
    canonicalRoot,
    canonicalCwd,
    "File environment cwd must stay inside workspaceRoot.",
  );

  const canonicalBlocked = await Promise.all(blockedRoots.map(async (root) => {
    if (typeof root !== "string" || !root || root.includes("\0") || !isAbsolute(root)) {
      throw new FileError(
        "invalid-config",
        "File environment blocked roots must be non-empty absolute paths.",
      );
    }
    const canonical = await canonicalDirectory(
      root,
      "File environment blocked root could not be resolved.",
      "File environment blocked root must be a directory.",
    );
    assertFileContained(
      canonicalRoot,
      canonical,
      "File environment blocked roots must stay inside workspaceRoot.",
    );
    return canonical;
  }));

  return Object.freeze({
    cwd: canonicalCwd,
    workspaceRoot: canonicalRoot,
    ...(canonicalBlocked.length === 0
      ? {}
      : { blockedRoots: Object.freeze(canonicalBlocked) }),
  });
}

export async function resolveFileTarget(
  environment: FileEnvironment,
  inputPath: FilePath,
): Promise<FileTarget> {
  validateFilePath(inputPath);
  const candidate = resolve(environment.cwd, inputPath);

  try {
    const canonical = await realpath(candidate);
    assertEnvironmentAllowed(environment, canonical);
    return Object.freeze({
      inputPath,
      path: canonical,
      exists: true,
    });
  } catch (error: unknown) {
    if (error instanceof FileError) throw error;
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
  assertEnvironmentAllowed(environment, canonicalParent);

  return Object.freeze({
    inputPath,
    path: join(canonicalParent, basename(candidate)),
    exists: false,
  });
}

function assertEnvironmentAllowed(
  environment: FileEnvironment,
  path: string,
): void {
  if (environment.workspaceRoot !== undefined) {
    assertFileContained(
      environment.workspaceRoot,
      path,
      "File target escapes the current Project Workspace.",
    );
  }
  for (const blocked of environment.blockedRoots ?? []) {
    if (isContained(blocked, path)) {
      throw new FileError(
        "path-not-allowed",
        "File target belongs to Navo internal storage and requires a trusted Project capability.",
      );
    }
  }
}

function assertFileContained(parent: string, child: string, message: string): void {
  if (isContained(parent, child)) return;
  throw new FileError("path-not-allowed", message);
}

function isContained(parent: string, child: string): boolean {
  const fromParent = relative(parent, child);
  return fromParent === ""
    || (fromParent !== ".."
      && !fromParent.startsWith(`..${sep}`)
      && !isAbsolute(fromParent));
}

async function canonicalDirectory(
  path: string,
  resolveMessage: string,
  directoryMessage: string,
): Promise<string> {
  let canonical: string;
  try {
    canonical = await realpath(path);
  } catch (error: unknown) {
    throw classifyFileError(error, resolveMessage);
  }
  try {
    if (!(await stat(canonical)).isDirectory()) {
      throw new FileError("not-a-directory", directoryMessage);
    }
  } catch (error: unknown) {
    if (error instanceof FileError) throw error;
    throw classifyFileError(error, directoryMessage);
  }
  return canonical;
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
