import { RpcError } from "../../errors.js";
import { exactKeys, requireBoundedString, requireRecord } from "../../validation.js";
import type { ResourceSearchAvailabilityV1, ResourceSearchChunkV1, ResourceSearchInputV1,
  ResourceSearchItemV1, ResourceSearchResultV1 } from "../search.js";

const ID_MAX = 256;
const QUERY_MAX = 4_096;
const FOLDER_MAX = 4_096;
const TOKEN_MAX = 256;
const TEXT_MAX = 16_384;
const MAX_RESULTS = 100;
const MAX_CHUNKS = 3;
const MAX_ARRAY = 128;
const MAX_HEADING = 512;

export function parseResourceSearchInput(value: unknown): ResourceSearchInputV1 {
  const record = requireRecord(value, "resource search input");
  if (Reflect.ownKeys(record).some(key => typeof key !== "string" || !["projectId", "query", "folder", "limit", "offset", "searchToken"].includes(key))) invalid("Malformed resource search input");
  if (record.folder !== undefined && (typeof record.folder !== "string" || record.folder.length > FOLDER_MAX) && record.folder !== null) invalid("Search folder is invalid");
  if (record.searchToken !== undefined && (typeof record.searchToken !== "string" || record.searchToken.length > TOKEN_MAX)) invalid("Search token is invalid");
  return {
    projectId: string(record.projectId, "projectId", ID_MAX),
    query: string(record.query, "query", QUERY_MAX).trim(),
    folder: (record.folder ?? null) as string | null,
    limit: page(record.limit, "limit", 20),
    offset: offset(record.offset),
    ...(record.searchToken === undefined ? {} : { searchToken: record.searchToken as string }),
  };
}

export function parseResourceSearchResult(value: unknown): ResourceSearchResultV1 {
  const record = shape(value, ["projectId", "query", "folder", "status", "errorCode", "results", "nextOffset", "searchToken", "availability"], "resource search result");
  if (typeof record.folder !== "string" && record.folder !== null) invalid("Search result folder is invalid");
  if (typeof record.status !== "string" || !statuses.has(record.status)) invalid("Unknown resource search status");
  if (record.errorCode !== null && (typeof record.errorCode !== "string" || !errorCodes.has(record.errorCode))) invalid("Unknown resource search error code");
  if (!Array.isArray(record.results) || record.results.length > MAX_RESULTS) invalid("Too many resource search results");
  if (record.nextOffset !== null && (!Number.isSafeInteger(record.nextOffset) || (record.nextOffset as number) < 0)) invalid("Search nextOffset is invalid");
  if (record.searchToken !== null && (typeof record.searchToken !== "string" || record.searchToken.length > TOKEN_MAX)) invalid("Search result token is invalid");
  return {
    projectId: string(record.projectId, "projectId", ID_MAX), query: string(record.query, "query", QUERY_MAX), folder: record.folder as string | null,
    status: record.status as ResourceSearchResultV1["status"], errorCode: record.errorCode as ResourceSearchResultV1["errorCode"], results: record.results.map(parseItem),
    nextOffset: record.nextOffset as number | null, searchToken: record.searchToken as string | null,
    availability: parseAvailability(record.availability),
  };
}

function parseItem(value: unknown): ResourceSearchItemV1 {
  const record = shape(value, ["resourceId", "name", "libraryPath", "assetGeneration", "fusionScore", "chunks"], "resource search item");
  if (!Array.isArray(record.chunks) || record.chunks.length > MAX_CHUNKS) invalid("Too many chunks in search item");
  return { resourceId: string(record.resourceId, "resourceId", ID_MAX), name: string(record.name, "name", 4_096),
    libraryPath: string(record.libraryPath, "libraryPath", FOLDER_MAX), assetGeneration: positive(record.assetGeneration, "assetGeneration"),
    fusionScore: finite(record.fusionScore, "fusionScore"), chunks: record.chunks.map(parseChunk) };
}

function parseChunk(value: unknown): ResourceSearchChunkV1 {
  const record = shape(value, ["resourceId", "chunkId", "ordinal", "text", "startOffsetUtf16", "endOffsetUtf16", "headingPath", "pages", "fusionScore", "rank", "assetGeneration", "matches"], "resource search chunk");
  if (!Array.isArray(record.headingPath) || record.headingPath.length > MAX_ARRAY || record.headingPath.some(item => typeof item !== "string" || item.length > MAX_HEADING)) invalid("Search heading path is invalid");
  if (!Array.isArray(record.pages) || record.pages.length > MAX_ARRAY || record.pages.some(item => !Number.isSafeInteger(item) || (item as number) < 0)) invalid("Search pages are invalid");
  if (!Array.isArray(record.matches) || record.matches.length > 3 || record.matches.some(item => !matches.has(item))) invalid("Search matches are invalid");
  return { resourceId: string(record.resourceId, "chunk resourceId", ID_MAX), chunkId: string(record.chunkId, "chunkId", ID_MAX),
    ordinal: nonNegative(record.ordinal, "ordinal"), text: string(record.text, "text", TEXT_MAX),
    startOffsetUtf16: nonNegative(record.startOffsetUtf16, "startOffsetUtf16"), endOffsetUtf16: nonNegative(record.endOffsetUtf16, "endOffsetUtf16"),
    headingPath: record.headingPath as string[], pages: record.pages as number[], fusionScore: finite(record.fusionScore, "chunk fusionScore"),
    rank: positive(record.rank, "rank"), assetGeneration: positive(record.assetGeneration, "chunk assetGeneration"),
    matches: record.matches as ResourceSearchChunkV1["matches"],
  };
}

function parseAvailability(value: unknown): ResourceSearchAvailabilityV1 {
  const record = shape(value, ["searchable", "pending", "failed", "unindexed"], "resource search availability");
  return { searchable: nonNegative(record.searchable, "searchable"), pending: nonNegative(record.pending, "pending"), failed: nonNegative(record.failed, "failed"), unindexed: nonNegative(record.unindexed, "unindexed") };
}

function shape(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const record = requireRecord(value, label);
  if (!exactKeys(record, keys)) invalid(`Malformed ${label}`);
  return record;
}

function string(value: unknown, label: string, max: number): string { return requireBoundedString(value, label, max); }
function page(value: unknown, label: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > 100) invalid(`${label} must be from 1 through 100`);
  return value as number;
}
function offset(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0 || (value as number) > 100) invalid("offset must be from 0 through 100");
  return value as number;
}
function positive(value: unknown, label: string): number { return nonNegative(value, label, 1); }
function nonNegative(value: unknown, label: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) invalid(`${label} is invalid`);
  return value as number;
}
function finite(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) invalid(`${label} is invalid`);
  return value;
}
function invalid(message: string): never { throw new RpcError("invalid-frame", message); }

const statuses = new Set(["ready", "no-results", "content-unavailable", "retrieval-unavailable", "failed"]);
const errorCodes = new Set(["content-unavailable", "embedding-unconfigured", "index-unavailable", "search-failed"]);
const matches = new Set(["vector", "entity", "graph"]);
