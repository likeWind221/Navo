import { RpcError } from "../../errors.js";
import { exactKeys, requireBoundedString, requireRecord } from "../../validation.js";
import { parseLibraryItem } from "../validation.js";
import type { ResourceIndexStatusV1, ResourceQueryInputV1, ResourceQueryItemV1, ResourceQueryResultV1 } from "../query.js";

const ID_MAX = 128;
const QUERY_MAX = 256;
const FOLDER_MAX = 4_096;
const TOKEN_MAX = 8_192;
const PAGE_MAX = 100;

export function parseResourceQueryInput(value: unknown): ResourceQueryInputV1 {
  const input = optionalShape(value, ["projectId", "query", "folder", "limit", "offset", "expectedChangeToken"], "resource query input");
  let result: ResourceQueryInputV1 = {
    projectId: id(input.projectId, "projectId"),
    limit: optionalPage(input.limit, "limit", 30),
    offset: optionalOffset(input.offset),
  };
  if (input.query !== undefined) result = { ...result, query: normalizedQuery(input.query) };
  if (input.folder !== undefined) result = { ...result, folder: optionalFolder(input.folder)! };
  if (input.expectedChangeToken !== undefined) result = { ...result, expectedChangeToken: optionalToken(input.expectedChangeToken)! };
  return result;
}

export function parseResourceQueryResult(value: unknown): ResourceQueryResultV1 {
  const result = shape(value, ["projectId", "query", "folder", "resources", "nextOffset", "changeToken"], "resource query result");
  if (!Array.isArray(result.resources) || result.resources.length > PAGE_MAX) invalid("Resource query result has too many resources");
  if (result.folder !== null && typeof result.folder !== "string") invalid("Resource query folder is invalid");
  if (result.nextOffset !== null && (!Number.isSafeInteger(result.nextOffset) || (result.nextOffset as number) < 0)) invalid("Resource query nextOffset is invalid");
  return {
    projectId: id(result.projectId, "projectId"),
    query: resultQuery(result.query),
    folder: result.folder as string | null,
    resources: result.resources.map(parseResourceQueryItem),
    nextOffset: result.nextOffset as number | null,
    changeToken: token(result.changeToken),
  };
}

function parseResourceQueryItem(value: unknown): ResourceQueryItemV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Resource query item must be an object");
  const record = value as Record<string, unknown>;
  if (!Object.hasOwn(record, "index")) invalid("Resource query item is missing index status");
  const { index, ...base } = record;
  return { ...parseLibraryItem(base), index: parseIndexStatus(index) };
}

function parseIndexStatus(value: unknown): ResourceIndexStatusV1 {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid("Resource index status must be an object");
  const record = value as Record<string, unknown>;
  if (Reflect.ownKeys(record).length !== 2 || !Object.hasOwn(record, "status") || !Object.hasOwn(record, "errorCode")) {
    invalid("Malformed resource index status");
  }
  if (record.status !== "waiting-config" && record.status !== "absent" && record.status !== "building"
    && record.status !== "active" && record.status !== "failed" && record.status !== "stale") {
    invalid("Unknown resource index status");
  }
  if (record.errorCode !== null && (typeof record.errorCode !== "string" || record.errorCode.length > 256)) {
    invalid("Resource index errorCode is invalid");
  }
  return { status: record.status, errorCode: record.errorCode } as ResourceIndexStatusV1;
}

function optionalShape(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const record = requireRecord(value, label);
  if (Reflect.ownKeys(record).some(key => typeof key !== "string" || !keys.includes(key))) invalid(`Malformed ${label}`);
  return record;
}

function shape(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const record = requireRecord(value, label);
  if (!exactKeys(record, keys)) invalid(`Malformed ${label}`);
  return record;
}

function id(value: unknown, label: string): string { return requireBoundedString(value, label, ID_MAX); }

function optionalText(value: unknown, label: string, maximum: number): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string" || value.length > maximum) invalid(`${label} is invalid`);
  return value;
}

function normalizedQuery(value: unknown): string {
  const raw = optionalText(value, "query", QUERY_MAX)!;
  const normalized = raw.trim().toLowerCase();
  if (normalized.length > QUERY_MAX) invalid("query exceeds the normalized length limit");
  return normalized;
}

function resultQuery(value: unknown): string {
  if (typeof value !== "string" || value.length > QUERY_MAX) invalid("query is invalid");
  return value;
}

function optionalFolder(value: unknown): string | null | undefined {
  if (value === undefined || value === null) return value;
  if (typeof value !== "string" || value.length > FOLDER_MAX) invalid("folder is invalid");
  return value;
}

function optionalPage(value: unknown, label: string, fallback: number): number {
  if (value === undefined) return fallback;
  if (!Number.isSafeInteger(value) || (value as number) < 1 || (value as number) > PAGE_MAX) invalid(`${label} must be from 1 through ${PAGE_MAX}`);
  return value as number;
}

function optionalOffset(value: unknown): number {
  if (value === undefined) return 0;
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid("offset must be a non-negative safe integer");
  return value as number;
}

function optionalToken(value: unknown): string | undefined {
  if (value === undefined) return undefined;
  return token(value);
}

function token(value: unknown): string {
  return requireBoundedString(value, "changeToken", TOKEN_MAX);
}

function invalid(message: string): never { throw new RpcError("invalid-frame", message); }
