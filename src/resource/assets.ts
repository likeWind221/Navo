import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, open, readFile, rm, rmdir, stat, writeFile, copyFile } from "node:fs/promises";
import { constants } from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ProjectWorkspace } from "../workspace/model.js";
import { ensureOwnedDirectory } from "../workspace/path.js";
import { normalizeLibraryPath } from "./library.js";
import { ResourceError } from "./errors.js";

export const ASSET_LIMITS = Object.freeze({ maxFileBytes: 100 * 1024 * 1024 });

export async function assetLocation(workspace: ProjectWorkspace, relpath: string, prepare = false): Promise<string> {
  const parts = normalizeLibraryPath(relpath).split("/");
  let parent = workspace.navoRoot;
  const rootInfo = await lstat(parent);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Unsafe internal storage root.");
  for (let index = 0; index < parts.length - 1; index++) {
    const part = parts[index]!;
    const next = join(parent, part);
    if (prepare) await ensureOwnedDirectory(next, parent);
    else {
      try {
        const info = await lstat(next);
        if (info.isSymbolicLink() || !info.isDirectory()) throw new Error("Unsafe asset directory.");
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") return join(parent, ...parts.slice(index));
        throw error;
      }
    }
    parent = next;
  }
  const target = join(parent, parts.at(-1)!);
  try {
    if ((await lstat(target)).isSymbolicLink()) throw new Error("Unsafe asset symbolic link.");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  return target;
}

export async function stageAsset(source: string, target: string, signal?: AbortSignal, maxFileBytes = ASSET_LIMITS.maxFileBytes): Promise<void> {
  if ((await stat(source)).size > maxFileBytes) throw oversized(maxFileBytes);
  let bytes = 0;
  const limit = new Transform({ transform(chunk: Buffer, _encoding, done) {
    bytes += chunk.length;
    done(bytes > maxFileBytes ? oversized(maxFileBytes) : null, chunk);
  } });
  await pipeline(createReadStream(source), limit, createWriteStream(target, { flags: "wx", flush: true }), { signal });
}

export async function removeAsset(workspace: ProjectWorkspace, relpath: string): Promise<void> {
  const target = await assetLocation(workspace, relpath);
  await rm(target, { force: true });
  await removeEmptyParents(dirname(target), join(workspace.navoRoot, "staging", "resource-intake"));
}

export async function prepareVersion(workspace: ProjectWorkspace, relpath: string, staged: string, operationId: string): Promise<void> {
  const version = dirname(relpath).replace(/\\/g, "/");
  const placeholder = await assetLocation(workspace, `${version}/placeholder`);
  await assetLocation(workspace, `${version.split("/").slice(0, -1).join("/")}/placeholder`, true);
  await mkdir(dirname(placeholder));
  await writeFile(join(dirname(placeholder), ".operation"), operationId, { flag: "wx", flush: true });
  await copyFile(staged, await assetLocation(workspace, relpath), constants.COPYFILE_EXCL);
  const handle = await open(await assetLocation(workspace, relpath), "r+");
  try { await handle.sync(); } finally { await handle.close(); }
}

export async function versionOwner(workspace: ProjectWorkspace, relpath: string): Promise<string | undefined> {
  const target = await assetLocation(workspace, relpath);
  try {
    const marker = await assetLocation(workspace, `${dirname(relpath).replace(/\\/g, "/")}/.operation`);
    return await readFile(marker, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    try { await lstat(target); } catch (missing) {
      if ((missing as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw missing;
    }
    throw new Error("Asset has no durable operation ownership marker.");
  }
}

export async function removeVersion(workspace: ProjectWorkspace, relpath: string): Promise<void> {
  const target = await assetLocation(workspace, relpath);
  await rm(target, { force: true });
  await rm(join(dirname(target), ".operation"), { force: true });
  await removeEmptyParents(dirname(target), workspace.assetsRoot);
}

export async function pruneVersion(workspace: ProjectWorkspace, relpath: string): Promise<void> {
  await removeEmptyParents(dirname(await assetLocation(workspace, relpath)), workspace.assetsRoot);
}

async function removeEmptyParents(directory: string, boundary: string): Promise<void> {
  while (true) {
    const within = relative(boundary, directory);
    if (within === "") return;
    if (isAbsolute(within) || within === ".." || within.startsWith(`..${sep}`)) throw new Error("Empty directory cleanup escaped its boundary.");
    try { await rmdir(directory); } catch (error) {
      if (["ENOTEMPTY", "EEXIST"].includes((error as NodeJS.ErrnoException).code ?? "")) return;
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    directory = dirname(directory);
  }
}

function oversized(maxFileBytes: number): ResourceError {
  return new ResourceError("invalid-resource", `Resource exceeds the ${maxFileBytes} byte single-file limit.`);
}
