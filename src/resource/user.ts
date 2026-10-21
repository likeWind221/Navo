import { lstat, readdir } from "node:fs/promises";
import { basename, isAbsolute, join, relative, sep } from "node:path";
import { Service, type Context } from "cordis";
import type { ProjectId } from "../brand/ids.js";
import type { ResourceContentRecord } from "../storage/content.js";
import type { DeleteResourceInput, ReplaceResourceInput, UpdateResourceInput } from "./model.js";
import { ASSET_LIMITS } from "./assets.js";
import { ResourceError } from "./errors.js";
import { normalizeLibraryPath } from "./library.js";
import { requireActiveResourceProject } from "./validation.js";

export interface UserImportInput {
  readonly projectId: ProjectId;
  readonly requestId: string;
  readonly sources: readonly { readonly kind: "file" | "directory"; readonly path: string }[];
}

export type UserImportResult =
  | { readonly status: "saved"; readonly name: string; readonly relativePath: string;
      readonly resourceId: string; readonly libraryPath: string; readonly contentStatus: ResourceContentRecord["status"] | null }
  | { readonly status: "failed"; readonly name: string; readonly relativePath: string;
      readonly code: string; readonly message: string }
  | { readonly status: "cancelled"; readonly name: string; readonly relativePath: string };

interface ImportFile {
  readonly path: string;
  readonly relativePath: string;
  readonly error?: "invalid-path" | "invalid-source" | "file-too-large";
}

const MAX_FILES = 256;
const MAX_DIRECTORIES = 1024;
const MAX_TOTAL_BYTES = 1024 * 1024 * 1024;

export class UserResourceService extends Service {
  static inject = ["projects", "resources", "content"];

  constructor(ctx: Context) {
    super(ctx, "userResources");
  }

  update(input: Omit<UpdateResourceInput, "actor">) {
    return this.ctx.resources.updateUser(input);
  }

  async replace(input: Omit<ReplaceResourceInput, "actor" | "sourceRef">, sourcePath: string, signal?: AbortSignal) {
    if (!isAbsolute(sourcePath)) throw new ResourceError("invalid-resource", "Replacement source must be absolute.");
    const source = await lstat(sourcePath);
    if (!source.isFile() || source.isSymbolicLink()) {
      throw new ResourceError("invalid-resource", "Replacement source must be a regular file.");
    }
    return this.ctx.resources.replaceUser({ ...input,
      sourceRef: `user-replace/${input.resourceId}/${input.expectedRevision}/${basename(sourcePath)}` },
      { filename: basename(sourcePath), receive: async () => ({ path: sourcePath }) }, signal);
  }

  delete(input: Omit<DeleteResourceInput, "actor">) {
    return this.ctx.resources.deleteUser(input);
  }

  async *import(input: UserImportInput, signal: AbortSignal): AsyncGenerator<UserImportResult> {
    requireActiveResourceProject(this.ctx, input.projectId);
    const files = await collectFiles(input.sources, signal);
    for (let index = 0; index < files.length; index += 1) {
      const file = files[index]!;
      const name = basename(file.relativePath);
      if (signal.aborted) {
        yield { status: "cancelled", name, relativePath: file.relativePath };
        continue;
      }
      if (file.error === "invalid-path") {
        yield { status: "failed", name, relativePath: file.relativePath,
          code: file.error, message: failureMessage(file.error) };
        continue;
      }
      try {
        const resource = await this.ctx.resources.importUser({
          operationId: `${input.projectId}_${input.requestId}_${index}`,
          projectId: input.projectId,
          sourceRef: `user-intake/${input.requestId}/${index}/${file.relativePath}`,
          name,
          description: "",
          type: resourceType(name),
          libraryPath: file.relativePath,
        }, { filename: name, receive: async () => {
          if (file.error !== undefined) throw new ResourceError("invalid-resource", failureMessage(file.error));
          const current = await lstat(file.path);
          if (!current.isFile() || current.isSymbolicLink()) {
            throw new ResourceError("invalid-resource", "Import source changed before reading.");
          }
          return { path: file.path };
        } }, signal);
        yield { status: "saved", name, relativePath: file.relativePath, resourceId: resource.id,
          libraryPath: resource.libraryPath,
          contentStatus: this.ctx.content.status(input.projectId, resource.id)?.status ?? null };
      } catch (error) {
        if (signal.aborted) {
          yield { status: "cancelled", name, relativePath: file.relativePath };
        } else {
          const code = error instanceof ResourceError && error.code === "operation-result-stale"
            ? error.code : file.error ?? (error instanceof ResourceError ? error.code : "import-failed");
          yield { status: "failed", name, relativePath: file.relativePath, code, message: failureMessage(code) };
        }
      }
    }
  }
}

async function collectFiles(sources: UserImportInput["sources"], signal: AbortSignal): Promise<ImportFile[]> {
  const files: ImportFile[] = [];
  let directories = 0;
  let totalBytes = 0;
  for (const source of sources) {
    if (signal.aborted) break;
    if (!isAbsolute(source.path)) throw new ResourceError("invalid-resource", "Import source must be absolute.");
    const root = source.path;
    const rootInfo = await lstat(root).catch(() => undefined);
    if (rootInfo === undefined || rootInfo.isSymbolicLink()
      || !(source.kind === "file" ? rootInfo.isFile() : rootInfo.isDirectory())) {
      files.push({ path: root, relativePath: basename(root), error: "invalid-source" });
      continue;
    }
    const pending = source.kind === "file" ? [root] : (await readdir(root)).sort().reverse().map(name => join(root, name));
    while (pending.length > 0) {
      if (signal.aborted) break;
      const path = pending.pop()!;
      const pathInfo = await lstat(path);
      if (pathInfo.isDirectory() && !pathInfo.isSymbolicLink()) {
        if (++directories > MAX_DIRECTORIES) throw new ResourceError("invalid-resource", "Import contains too many directories.");
        const children = (await readdir(path)).sort().reverse();
        for (const name of children) pending.push(join(path, name));
        continue;
      }
      if (files.length === MAX_FILES) throw new ResourceError("invalid-resource", "Import contains too many files.");
      const relativePath = source.kind === "file" ? basename(path) : relative(root, path).split(sep).join("/");
      let error: ImportFile["error"];
      try { normalizeLibraryPath(relativePath); } catch { error = "invalid-path"; }
      if (pathInfo.isSymbolicLink() || !pathInfo.isFile()) error ??= "invalid-source";
      if (pathInfo.size > ASSET_LIMITS.maxFileBytes) error ??= "file-too-large";
      if (error === undefined) {
        totalBytes += pathInfo.size;
        if (totalBytes > MAX_TOTAL_BYTES) throw new ResourceError("invalid-resource", "Import exceeds the total size limit.");
      }
      files.push({ path, relativePath, ...(error === undefined ? {} : { error }) });
    }
  }
  return files;
}

function resourceType(name: string): string {
  const extension = name.slice(name.lastIndexOf(".")).toLowerCase();
  if (extension === ".md" || extension === ".markdown") return "text/markdown";
  if (extension === ".txt") return "text/plain";
  if (extension === ".pdf") return "application/pdf";
  return "application/octet-stream";
}

function failureMessage(code: string): string {
  if (code === "invalid-path") return "File name or relative path is invalid.";
  if (code === "invalid-source") return "Source is not a regular file.";
  if (code === "file-too-large") return "File exceeds the 100 MiB limit.";
  if (code === "resource-already-exists") return "Resource path is already in use.";
  if (code === "operation-result-stale") return "The prior import result has changed.";
  return "File could not be saved.";
}

declare module "cordis" {
  interface Context {
    userResources: UserResourceService;
  }
}
