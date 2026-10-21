import { posix } from "node:path";
import { ResourceError } from "./errors.js";

export function normalizeLibraryPath(value: unknown): string {
  if (typeof value !== "string") throw invalidPath();
  const path = value.normalize("NFC");
  const segments = path.split("/");
  if (segments.some(segment => !segment || segment === "." || segment === ".."
    || /[\\\x00-\x1f<>:"|?*]/u.test(segment) || /[. ]$/u.test(segment)
    || /^(con|prn|aux|nul|com[1-9¹²³]|lpt[1-9¹²³])(?:\.|$)/iu.test(segment))) throw invalidPath();
  return path;
}

export function libraryPathKey(value: string): string {
  return normalizeLibraryPath(value).toLowerCase().normalize("NFC");
}

export function numberedLibraryPath(path: string, occupied: ReadonlySet<string>): string {
  const normalized = normalizeLibraryPath(path);
  const extension = posix.extname(normalized);
  const stem = normalized.slice(0, normalized.length - extension.length);
  let candidate = normalized;
  for (let n = 1; occupied.has(libraryPathKey(candidate)); n++) candidate = `${stem} (${n})${extension}`;
  return candidate;
}

export function parentLibraryPath(path: string): string | null {
  const index = path.lastIndexOf("/");
  return index < 0 ? null : path.slice(0, index);
}

export function folderPrefixes(path: string): readonly string[] {
  const parts = normalizeLibraryPath(path).split("/");
  return parts.slice(0, -1).map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function insideFolder(path: string, folder: string): boolean {
  const key = libraryPathKey(path);
  const root = libraryPathKey(folder);
  return key === root || key.startsWith(`${root}/`);
}

export function numberedFolderPath(path: string, occupied: ReadonlySet<string>): string {
  const normalized = normalizeLibraryPath(path);
  let candidate = normalized;
  for (let n = 1; occupied.has(libraryPathKey(candidate)); n++) candidate = `${normalized} (${n})`;
  return candidate;
}

function invalidPath(): ResourceError {
  return new ResourceError("invalid-resource", "Resource logical path must be a safe NFC portable relative path.");
}
