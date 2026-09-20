import { realpath, stat } from "node:fs/promises";
import {
  basename,
  isAbsolute,
  join,
  relative,
  sep,
} from "node:path";

import type { ResourceId } from "../brand/ids.js";
import type { ProjectWorkspace } from "../workspace/model.js";
import { ensureOwnedDirectory } from "../workspace/path.js";
import { ResourceError } from "./errors.js";
import type {
  ProjectResource,
  ResourceEntryTarget,
} from "./model.js";

export interface ResourcePublishSource {
  readonly path: string;
  readonly entryRef: string;
}

export function validateResourceEntryRef(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.includes("\0")
    || value.includes("\\")
    || value.startsWith("/")
    || isAbsolute(value)
    || /^[A-Za-z]:\//.test(value)
  ) {
    throw new ResourceError(
      "invalid-resource",
      "Resource entryRef must be a portable relative path.",
    );
  }
  const segments = value.split("/");
  if (segments.some(segment => segment.length === 0 || segment === "." || segment === "..")) {
    throw new ResourceError(
      "invalid-resource",
      "Resource entryRef cannot contain empty, dot, or parent segments.",
    );
  }
  return value;
}

export function resourceEntryRefFromSource(value: unknown): string {
  const sourceRef = validateWorkspaceSourceRef(value);
  return validateResourceEntryRef(basename(sourceRef));
}

export async function resolveResourcePublishSource(
  workspace: ProjectWorkspace,
  sourceRef: string,
): Promise<ResourcePublishSource> {
  const normalized = validateWorkspaceSourceRef(sourceRef);
  let source: string;
  try {
    source = await realpath(join(workspace.root, ...normalized.split("/")));
    assertContained(workspace.root, source);
    if (isContained(workspace.navoRoot, source)) {
      throw new ResourceError(
        "resource-content-unavailable",
        "Resource source must come from the user Workspace, not Navo internal storage.",
      );
    }
    if (!(await stat(source)).isFile()) {
      throw new ResourceError(
        "resource-content-unavailable",
        "Resource source must be a regular file.",
      );
    }
  } catch (error: unknown) {
    if (error instanceof ResourceError) throw error;
    throw new ResourceError(
      "resource-content-unavailable",
      "Resource source file is unavailable.",
      { cause: error },
    );
  }
  return Object.freeze({
    path: source,
    entryRef: resourceEntryRefFromSource(normalized),
  });
}

export async function ensureResourceRoot(
  workspace: ProjectWorkspace,
  resourceId: ResourceId,
): Promise<string> {
  const candidate = join(workspace.assetsRoot, resourceDirectoryName(resourceId));
  try {
    return await ensureOwnedDirectory(candidate, workspace.assetsRoot);
  } catch (error: unknown) {
    throw new ResourceError(
      "resource-content-unavailable",
      "Resource content root could not be prepared.",
      { cause: error },
    );
  }
}

export async function resolveResourceEntry(
  workspace: ProjectWorkspace,
  resource: ProjectResource,
): Promise<ResourceEntryTarget> {
  const entryRef = validateResourceEntryRef(resource.entryRef);
  const expectedRoot = join(
    workspace.assetsRoot,
    resourceDirectoryName(resource.id),
  );

  let resourceRoot: string;
  let target: string;
  try {
    resourceRoot = await realpath(expectedRoot);
    assertContained(workspace.assetsRoot, resourceRoot);
    target = await realpath(join(resourceRoot, ...entryRef.split("/")));
    assertContained(resourceRoot, target);
    if (!(await stat(target)).isFile()) {
      throw new ResourceError(
        "resource-content-unavailable",
        "Resource entry is not a regular file.",
      );
    }
  } catch (error: unknown) {
    if (error instanceof ResourceError) throw error;
    throw new ResourceError(
      "resource-content-unavailable",
      "Resource entry content is unavailable.",
      { cause: error },
    );
  }

  return Object.freeze({
    resourceId: resource.id,
    root: resourceRoot,
    path: target,
  });
}

function validateWorkspaceSourceRef(value: unknown): string {
  if (
    typeof value !== "string"
    || value.length === 0
    || value.includes("\0")
    || value.includes("\\")
    || value.startsWith("/")
    || isAbsolute(value)
    || /^[A-Za-z]:\//.test(value)
  ) {
    throw new ResourceError(
      "invalid-resource",
      "Resource source path must be a portable Workspace-relative path.",
    );
  }
  const segments = value.split("/");
  if (
    segments.some(segment => segment.length === 0 || segment === "." || segment === "..")
    || segments[0] === ".navo"
  ) {
    throw new ResourceError(
      "invalid-resource",
      "Resource source path must stay in the user Workspace outside .navo.",
    );
  }
  return value;
}

function resourceDirectoryName(resourceId: ResourceId): string {
  const value = String(resourceId);
  if (
    value.length === 0
    || value === "."
    || value === ".."
    || value.includes("/")
    || value.includes("\\")
    || value.includes("\0")
  ) {
    throw new ResourceError(
      "invalid-resource",
      "Resource id cannot be used as a content directory.",
    );
  }
  return value;
}

function assertContained(parent: string, child: string): void {
  if (isContained(parent, child)) return;
  throw new ResourceError(
    "resource-content-unavailable",
    "Resource content escapes its allowed root.",
  );
}

function isContained(parent: string, child: string): boolean {
  const fromParent = relative(parent, child);
  return fromParent === ""
    || (
      fromParent !== ".."
      && !fromParent.startsWith(`..${sep}`)
      && !isAbsolute(fromParent)
    );
}
