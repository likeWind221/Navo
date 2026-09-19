import { createHash } from "node:crypto";
import { lstat, mkdir, realpath, stat } from "node:fs/promises";
import {
  basename,
  dirname,
  isAbsolute,
  join,
  relative,
  sep,
} from "node:path";

import type { ProjectId } from "../brand/ids.js";
import { WorkspaceError } from "./errors.js";
import type { WorkspaceTarget } from "./model.js";

export function validateWorkspaceBaseRoot(root: unknown): string {
  if (
    typeof root !== "string"
    || root.length === 0
    || root.includes("\0")
    || !isAbsolute(root)
  ) {
    throw new WorkspaceError(
      "invalid-config",
      "Project Workspace root must be a non-empty absolute path.",
    );
  }
  return root;
}

export function projectDirectoryName(projectId: ProjectId): string {
  const digest = createHash("sha256").update(projectId, "utf8").digest("hex");
  return `project-${digest}`;
}

export async function canonicalBaseRoot(root: string): Promise<string> {
  let canonical: string;
  try {
    canonical = await realpath(root);
  } catch (error: unknown) {
    throw classifyWorkspaceIoError(
      error,
      "Project Workspace root could not be resolved.",
    );
  }
  await requireDirectory(canonical, "Project Workspace root is not a directory.");
  return canonical;
}

export async function ensureOwnedDirectory(
  candidate: string,
  boundary: string,
): Promise<string> {
  try {
    await mkdir(candidate);
  } catch (error: unknown) {
    if (!isCode(error, "EEXIST")) {
      throw classifyWorkspaceIoError(
        error,
        "Project Workspace directory could not be created.",
      );
    }
  }

  let info;
  try {
    info = await lstat(candidate);
  } catch (error: unknown) {
    throw classifyWorkspaceIoError(
      error,
      "Project Workspace directory could not be inspected.",
    );
  }
  if (info.isSymbolicLink()) {
    throw new WorkspaceError(
      "path-not-allowed",
      "Project Workspace owned directories cannot be symbolic links.",
    );
  }
  if (!info.isDirectory()) {
    throw new WorkspaceError(
      "not-a-directory",
      "Project Workspace path must be a directory.",
    );
  }

  let canonical: string;
  try {
    canonical = await realpath(candidate);
  } catch (error: unknown) {
    throw classifyWorkspaceIoError(
      error,
      "Project Workspace directory could not be resolved.",
    );
  }
  assertContained(boundary, canonical);
  return canonical;
}

export async function resolveWorkspaceTarget(
  projectId: ProjectId,
  workspaceRoot: string,
  ref: string,
): Promise<WorkspaceTarget> {
  const segments = parseWorkspaceRef(ref);
  const candidate = join(workspaceRoot, ...segments);

  try {
    const canonical = await realpath(candidate);
    assertContained(workspaceRoot, canonical);
    return Object.freeze({
      projectId,
      ref,
      path: canonical,
      exists: true,
    });
  } catch (error: unknown) {
    if (!isCode(error, "ENOENT")) {
      throw classifyWorkspaceIoError(
        error,
        "Project Workspace target could not be resolved.",
      );
    }
  }

  // A dangling symlink must not be reclassified as a safe missing leaf.
  try {
    const info = await lstat(candidate);
    if (info.isSymbolicLink()) {
      throw new WorkspaceError(
        "path-not-allowed",
        "Project Workspace refs cannot resolve through a dangling symbolic link.",
      );
    }
  } catch (error: unknown) {
    if (error instanceof WorkspaceError) throw error;
    if (!isCode(error, "ENOENT")) {
      throw classifyWorkspaceIoError(
        error,
        "Project Workspace target could not be inspected.",
      );
    }
  }

  let canonicalParent: string;
  try {
    canonicalParent = await realpath(dirname(candidate));
  } catch (error: unknown) {
    throw classifyWorkspaceIoError(
      error,
      "The parent of the Project Workspace target could not be resolved.",
    );
  }
  await requireDirectory(
    canonicalParent,
    "The parent of the Project Workspace target is not a directory.",
  );
  assertContained(workspaceRoot, canonicalParent);

  return Object.freeze({
    projectId,
    ref,
    path: join(canonicalParent, basename(candidate)),
    exists: false,
  });
}

export function assertContained(parent: string, child: string): void {
  const fromParent = relative(parent, child);
  if (
    fromParent === ""
    || (fromParent !== ".."
      && !fromParent.startsWith(`..${sep}`)
      && !isAbsolute(fromParent))
  ) {
    return;
  }
  throw new WorkspaceError(
    "path-not-allowed",
    "Project Workspace path escapes its Project boundary.",
  );
}

function parseWorkspaceRef(ref: unknown): string[] {
  if (
    typeof ref !== "string"
    || ref.length === 0
    || ref.includes("\0")
    || ref.includes("\\")
    || ref.startsWith("/")
    || isAbsolute(ref)
    || /^[A-Za-z]:\//.test(ref)
  ) {
    throw new WorkspaceError(
      "invalid-ref",
      "Project Workspace refs must be portable relative paths.",
    );
  }

  const segments = ref.split("/");
  if (segments.some(segment => segment.length === 0 || segment === "." || segment === "..")) {
    throw new WorkspaceError(
      "invalid-ref",
      "Project Workspace refs cannot contain empty, dot, or parent segments.",
    );
  }
  return segments;
}

async function requireDirectory(path: string, message: string): Promise<void> {
  try {
    if (!(await stat(path)).isDirectory()) {
      throw new WorkspaceError("not-a-directory", message);
    }
  } catch (error: unknown) {
    if (error instanceof WorkspaceError) throw error;
    throw classifyWorkspaceIoError(error, message);
  }
}

export function classifyWorkspaceIoError(
  error: unknown,
  message: string,
): WorkspaceError {
  if (error instanceof WorkspaceError) return error;
  if (isCode(error, "ENOENT")) {
    return new WorkspaceError("not-found", message, { cause: error });
  }
  if (isCode(error, "ENOTDIR")) {
    return new WorkspaceError("not-a-directory", message, { cause: error });
  }
  if (isCode(error, "EACCES") || isCode(error, "EPERM")) {
    return new WorkspaceError("permission-denied", message, { cause: error });
  }
  return new WorkspaceError("io-failed", message, { cause: error });
}

export function isCode(error: unknown, code: string): boolean {
  return error !== null
    && typeof error === "object"
    && "code" in error
    && error.code === code;
}
