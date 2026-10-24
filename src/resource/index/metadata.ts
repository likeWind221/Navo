import { ResourceIndexError } from "./errors.js";

export function chunkMetadata(row: { readonly heading_path_json: string; readonly page_map_json: string }): {
  readonly headingPath: readonly string[]; readonly pages: readonly number[];
} {
  const headingPath: unknown = JSON.parse(row.heading_path_json);
  const pages: unknown = JSON.parse(row.page_map_json);
  if (!Array.isArray(headingPath) || headingPath.some(item => typeof item !== "string")) {
    throw new ResourceIndexError("index-failed", "Stored Chunk heading path is invalid.");
  }
  if (!Array.isArray(pages) || pages.some(item => !Number.isSafeInteger(item) || item < 1)) {
    throw new ResourceIndexError("index-failed", "Stored Chunk page map is invalid.");
  }
  return { headingPath: Object.freeze(headingPath), pages: Object.freeze(pages) };
}
