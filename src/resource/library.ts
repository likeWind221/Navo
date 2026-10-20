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

function invalidPath(): ResourceError {
  return new ResourceError("invalid-resource", "Resource logical path must be a safe NFC portable relative path.");
}
