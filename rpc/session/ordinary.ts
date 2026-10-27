import type { RpcMethod, RpcOutputValidator } from "../protocol.js";
import { RpcError } from "../errors.js";
import { exactKeys, requireBoundedString, requireRecord } from "../validation.js";
import type {
  OrdinarySessionCursorV1,
  OrdinarySessionEntryV1,
  OrdinarySessionListInputV1,
  OrdinarySessionListV1,
  OrdinarySessionMutationInputV1,
  OrdinarySessionCreateInputV1,
} from "../session.js";

export const ORDINARY_SESSION_PAGE_MAX = 50;
export const ORDINARY_SESSION_TITLE_MAX = 200;

export const sessionCreateMethod: RpcMethod<OrdinarySessionCreateInputV1, OrdinarySessionEntryV1> = Object.freeze({
  name: "session.create.v1",
  parseInput: parseCreateInput,
  parseOutput: parseEntry,
  createOutputValidator: () => single(parseEntry),
});

export const sessionListMethod: RpcMethod<OrdinarySessionListInputV1, OrdinarySessionListV1> = Object.freeze({
  name: "session.list.v1",
  parseInput: parseListInput,
  parseOutput: parseList,
  createOutputValidator: (input: OrdinarySessionListInputV1) => listOutputValidator(input),
});

export const sessionRenameMethod: RpcMethod<OrdinarySessionMutationInputV1, OrdinarySessionEntryV1> = Object.freeze({
  name: "session.rename.v1",
  parseInput: parseRenameInput,
  parseOutput: parseEntry,
  createOutputValidator: (input: OrdinarySessionMutationInputV1) => mutationOutputValidator(input, undefined),
});

export const sessionArchiveMethod: RpcMethod<OrdinarySessionMutationInputV1, OrdinarySessionEntryV1> = Object.freeze({
  name: "session.archive.v1",
  parseInput: parseMutationInput,
  parseOutput: parseEntry,
  createOutputValidator: (input: OrdinarySessionMutationInputV1) => mutationOutputValidator(input, "archived"),
});

export const sessionRestoreMethod: RpcMethod<OrdinarySessionMutationInputV1, OrdinarySessionEntryV1> = Object.freeze({
  name: "session.restore.v1",
  parseInput: parseMutationInput,
  parseOutput: parseEntry,
  createOutputValidator: (input: OrdinarySessionMutationInputV1) => mutationOutputValidator(input, "active"),
});

function parseCreateInput(value: unknown): OrdinarySessionCreateInputV1 {
  const input = requireRecord(value, "session create input");
  if (!exactKeys(input, []) && !exactKeys(input, ["title"])) invalid("Malformed session create input");
  return input.title === undefined ? {} : { title: title(input.title) };
}

function parseListInput(value: unknown): OrdinarySessionListInputV1 {
  const input = requireRecord(value, "session list input");
  if (!exactKeys(input, ["limit", "status"]) && !exactKeys(input, ["limit", "status", "query"])
    && !exactKeys(input, ["limit", "status", "cursor"])
    && !exactKeys(input, ["limit", "status", "query", "cursor"])) invalid("Malformed session list input");
  if (!Number.isSafeInteger(input.limit) || (input.limit as number) < 1 || (input.limit as number) > ORDINARY_SESSION_PAGE_MAX) {
    invalid("Session list limit is out of range");
  }
  const query = input.query === undefined ? "" : queryText(input.query, "query");
  const status = oneOf(input.status, ["all", "active", "archived"] as const, "session status");
  const cursor = input.cursor === undefined ? undefined : parseCursor(input.cursor);
  if (cursor !== undefined && (cursor.query !== query || cursor.status !== status)) invalid("Session list cursor scope does not match input");
  return { limit: input.limit as number, query, status, ...(cursor === undefined ? {} : { cursor }) };
}

function parseRenameInput(value: unknown): OrdinarySessionMutationInputV1 {
  const input = requireRecord(value, "session rename input");
  if (!exactKeys(input, ["sessionId", "title", "expectedRevision"])) invalid("Malformed session rename input");
  return { sessionId: id(input.sessionId), title: title(input.title), expectedRevision: revision(input.expectedRevision) };
}

function parseMutationInput(value: unknown): OrdinarySessionMutationInputV1 {
  const input = requireRecord(value, "session mutation input");
  if (!exactKeys(input, ["sessionId", "expectedRevision"])) invalid("Malformed session mutation input");
  return { sessionId: id(input.sessionId), expectedRevision: revision(input.expectedRevision) };
}

function parseEntry(value: unknown): OrdinarySessionEntryV1 {
  const entry = requireRecord(value, "ordinary session entry");
  if (!exactKeys(entry, ["sessionId", "title", "status", "createdAt", "updatedAt", "revision"])) invalid("Malformed ordinary session entry");
  return {
    sessionId: id(entry.sessionId), title: title(entry.title),
    status: oneOf(entry.status, ["active", "archived"] as const, "session status"),
    createdAt: timestamp(entry.createdAt), updatedAt: timestamp(entry.updatedAt), revision: revision(entry.revision),
  };
}

function parseList(value: unknown): OrdinarySessionListV1 {
  const list = requireRecord(value, "ordinary session list");
  if (!exactKeys(list, ["catalogRevision", "entries", "nextCursor"])) invalid("Malformed ordinary session list");
  if (!Array.isArray(list.entries)) invalid("Session list entries must be an array");
  return {
    catalogRevision: catalogRevision(list.catalogRevision), entries: list.entries.map(parseEntry),
    nextCursor: list.nextCursor === null ? null : parseCursor(list.nextCursor),
  };
}

function parseCursor(value: unknown): OrdinarySessionCursorV1 {
  const cursor = requireRecord(value, "session list cursor");
  if (!exactKeys(cursor, ["catalogRevision", "offset", "query", "status"])) invalid("Malformed session list cursor");
  if (!Number.isSafeInteger(cursor.offset) || (cursor.offset as number) < 0) invalid("Session list cursor offset is invalid");
  return {
    catalogRevision: revision(cursor.catalogRevision), offset: cursor.offset as number,
    query: queryText(cursor.query, "cursor query"),
    status: oneOf(cursor.status, ["all", "active", "archived"] as const, "cursor status"),
  };
}

function single<T>(parse: (value: unknown) => T): RpcOutputValidator<T> {
  let received = false;
  return {
    parse(value) {
      if (received) invalidOutput("Session method returned more than one result");
      received = true;
      return parse(value);
    },
    end() {
      if (!received) invalidOutput("Session method ended before returning a result");
    },
  };
}

function listOutputValidator(input: OrdinarySessionListInputV1): RpcOutputValidator<OrdinarySessionListV1> {
  const singleResult = single(parseList);
  return {
    parse(value) {
      const list = singleResult.parse(value);
      if (input.cursor !== undefined && list.catalogRevision !== input.cursor.catalogRevision) {
        invalidOutput("Session list catalog revision does not match its request cursor");
      }
      if (list.entries.length > input.limit) invalidOutput("Session list exceeded its requested page size");
      const ids = new Set(list.entries.map(entry => entry.sessionId));
      if (ids.size !== list.entries.length) invalidOutput("Session list contains duplicate Sessions");
      if (list.nextCursor !== null) {
        const start = input.cursor?.offset ?? 0;
        if (list.entries.length === 0
          || list.nextCursor.catalogRevision !== list.catalogRevision
          || list.nextCursor.query !== input.query || list.nextCursor.status !== input.status
          || list.nextCursor.offset !== start + list.entries.length) {
          invalidOutput("Session list cursor does not continue this page");
        }
      }
      return list;
    },
    end() { singleResult.end(); },
  };
}

function mutationOutputValidator(
  input: OrdinarySessionMutationInputV1,
  expectedStatus: OrdinarySessionEntryV1["status"] | undefined,
): RpcOutputValidator<OrdinarySessionEntryV1> {
  const singleResult = single(parseEntry);
  return {
    parse(value) {
      const entry = singleResult.parse(value);
      if (entry.sessionId !== input.sessionId) invalidOutput("Session mutation returned another Session");
      if (expectedStatus !== undefined && entry.status !== expectedStatus) {
        invalidOutput("Session mutation returned the wrong status");
      }
      return entry;
    },
    end() { singleResult.end(); },
  };
}

function id(value: unknown): string { return requireBoundedString(value, "sessionId", 128); }
function title(value: unknown): string { return requireBoundedString(value, "title", ORDINARY_SESSION_TITLE_MAX); }
function queryText(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > 256) invalid(`${label} is out of range`);
  return value.trim().toLowerCase();
}
function timestamp(value: unknown): string {
  const result = requireBoundedString(value, "timestamp", 64);
  if (!Number.isFinite(Date.parse(result))) invalid("Timestamp is invalid");
  return result;
}
function revision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid("Revision must be positive");
  return value as number;
}
function catalogRevision(value: unknown): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid("Catalog revision must be non-negative");
  return value as number;
}
function oneOf<const T extends readonly string[]>(value: unknown, choices: T, label: string): T[number] {
  if (typeof value !== "string" || !choices.includes(value)) invalid(`Invalid ${label}`);
  return value as T[number];
}
function invalid(message: string): never { throw new RpcError("invalid-frame", message); }
function invalidOutput(message: string): never { throw new RpcError("invalid-output", message); }
