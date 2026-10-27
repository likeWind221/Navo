import { randomUUID } from "node:crypto";

import { Service } from "cordis";
import type { Context } from "cordis";

import { createSessionId } from "../brand/ids.js";
import type { SessionId } from "../brand/ids.js";
import { resolveAgentBinding } from "../project/binding.js";
import type { StorageTransaction } from "../storage/database.js";
import type { OrdinarySessionRecord } from "../storage/ordinary.js";

export const DEFAULT_SESSION_TITLE = "Untitled conversation";
export const SESSION_TITLE_MAX_CHARS = 200;

export type OrdinarySessionStatus = "active" | "archived";

export interface OrdinarySessionSnapshot {
  readonly sessionId: SessionId;
  readonly title: string;
  readonly status: OrdinarySessionStatus;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}

export type OrdinarySessionDirectoryErrorCode =
  | "session-not-found"
  | "session-not-ordinary"
  | "session-archived"
  | "session-active"
  | "session-revision-conflict"
  | "session-catalog-changed"
  | "session-unavailable"
  | "session-invalid-title";

export class OrdinarySessionDirectoryError extends Error {
  constructor(readonly code: OrdinarySessionDirectoryErrorCode, message: string) {
    super(message);
    this.name = "OrdinarySessionDirectoryError";
  }
}

export interface OrdinarySessionListInput {
  readonly query: string;
  readonly status: "all" | OrdinarySessionStatus;
  readonly limit: number;
  readonly cursor?: OrdinarySessionCursor;
}

export interface OrdinarySessionCursor {
  readonly catalogRevision: number;
  readonly offset: number;
  readonly query: string;
  readonly status: OrdinarySessionListInput["status"];
}

export interface OrdinarySessionListResult {
  readonly catalogRevision: number;
  readonly entries: readonly OrdinarySessionSnapshot[];
  readonly nextCursor: OrdinarySessionCursor | null;
}

declare module "cordis" {
  interface Context {
    sessionDirectory: OrdinarySessionDirectory;
  }
}

export class OrdinarySessionDirectory extends Service {
  static inject = ["storage", "projects", "nodes", "sessions"];

  private readonly entries = new Map<SessionId, OrdinarySessionRecord>();
  private readonly active = new Map<SessionId, number>();
  private unavailable = false;

  constructor(ctx: Context) {
    super(ctx, "sessionDirectory");
    this.migrate(ctx);
    for (const record of ctx.storage.atomic(tx => tx.listOrdinarySessions())) {
      this.entries.set(createSessionId(record.sessionId), record);
    }
    this.ctx.effect(() => () => {
      this.unavailable = true;
      this.active.clear();
    }, "sessionDirectory.lifecycle");
  }

  create(title?: string): OrdinarySessionSnapshot {
    this.requireAvailable();
    const normalizedTitle = normalizeTitle(title);
    let sessionId: SessionId;
    do sessionId = createSessionId(randomUUID());
    while (this.entries.has(sessionId) || resolveAgentBinding(this.ctx, sessionId) !== undefined);
    const now = new Date().toISOString();
    const record = this.write(tx => {
      const next = tx.nextOrdinarySessionRevision();
      const value: OrdinarySessionRecord = {
        sessionId, title: normalizedTitle, archived: false,
        createdAt: now, updatedAt: now, revision: next,
      };
      tx.insertOrdinarySession(value);
      return value;
    });
    this.entries.set(sessionId, record);
    return snapshot(record);
  }

  list(input: OrdinarySessionListInput): OrdinarySessionListResult {
    this.requireAvailable();
    const revision = this.catalogRevision();
    if (input.cursor !== undefined) {
      if (input.cursor.catalogRevision !== revision || input.cursor.query !== input.query
        || input.cursor.status !== input.status) {
        throw new OrdinarySessionDirectoryError("session-catalog-changed", "Session directory changed; restart the listing.");
      }
    }
    const entries = [...this.entries.values()]
      .filter(record => input.status === "all" || (input.status === "active") !== record.archived)
      .filter(record => input.query === "" || record.title.toLowerCase().includes(input.query))
      .sort(compareRecords)
      .map(snapshot);
    const offset = input.cursor?.offset ?? 0;
    const page = entries.slice(offset, offset + input.limit);
    const nextOffset = offset + page.length;
    return {
      catalogRevision: revision,
      entries: Object.freeze(page),
      nextCursor: nextOffset < entries.length
        ? { catalogRevision: revision, offset: nextOffset, query: input.query, status: input.status }
        : null,
    };
  }

  rename(sessionId: SessionId, title: string, expectedRevision: number): OrdinarySessionSnapshot {
    return snapshot(this.mutate(sessionId, expectedRevision, record => ({ ...record, title: normalizeTitle(title) })));
  }

  archive(sessionId: SessionId, expectedRevision: number): OrdinarySessionSnapshot {
    return snapshot(this.mutate(sessionId, expectedRevision, record => {
      if (this.active.has(sessionId)) throw new OrdinarySessionDirectoryError("session-active", "Session has an active operation.");
      return { ...record, archived: true };
    }));
  }

  restore(sessionId: SessionId, expectedRevision: number): OrdinarySessionSnapshot {
    return snapshot(this.mutate(sessionId, expectedRevision, record => ({ ...record, archived: false })));
  }

  beginActivity(sessionId: SessionId): (() => void) | undefined {
    this.requireAvailable();
    const record = this.ensure(sessionId);
    if (record === undefined) return undefined;
    if (record.archived) throw new OrdinarySessionDirectoryError("session-archived", "Archived Session cannot start an operation.");
    this.active.set(sessionId, (this.active.get(sessionId) ?? 0) + 1);
    let released = false;
    return () => {
      if (released) return;
      released = true;
      const count = this.active.get(sessionId) ?? 0;
      if (count <= 1) this.active.delete(sessionId);
      else this.active.set(sessionId, count - 1);
    };
  }

  private ensure(sessionId: SessionId): OrdinarySessionRecord | undefined {
    if (resolveAgentBinding(this.ctx, sessionId) !== undefined) return undefined;
    const existing = this.entries.get(sessionId);
    if (existing !== undefined) return existing;
    if (this.ctx.storage.recovery.unavailableSessionIds.has(String(sessionId))) {
      throw new OrdinarySessionDirectoryError("session-unavailable", "Session history is unavailable.");
    }
    const events = this.ctx.sessions.getEvents(sessionId);
    const now = new Date().toISOString();
    const record = this.write(tx => {
      const next = tx.nextOrdinarySessionRevision();
      const value: OrdinarySessionRecord = {
        sessionId, title: DEFAULT_SESSION_TITLE, archived: false,
        createdAt: events[0]?.timestamp ?? now, updatedAt: events.at(-1)?.timestamp ?? now, revision: next,
      };
      tx.insertOrdinarySession(value);
      return value;
    });
    this.entries.set(sessionId, record);
    return record;
  }

  private mutate(
    sessionId: SessionId,
    expectedRevision: number,
    change: (record: OrdinarySessionRecord) => OrdinarySessionRecord,
  ): OrdinarySessionRecord {
    this.requireAvailable();
    const current = this.requireOrdinary(sessionId);
    if (current.revision !== expectedRevision) {
      throw new OrdinarySessionDirectoryError("session-revision-conflict", "Session metadata is stale.");
    }
    const changed = change(current);
    if (changed.title === current.title && changed.archived === current.archived) return current;
    const updated = this.write(tx => {
      const record = { ...changed, updatedAt: new Date().toISOString(), revision: tx.nextOrdinarySessionRevision() };
      tx.updateOrdinarySession(record);
      return record;
    });
    this.entries.set(sessionId, updated);
    return updated;
  }

  private requireOrdinary(sessionId: SessionId): OrdinarySessionRecord {
    if (resolveAgentBinding(this.ctx, sessionId) !== undefined) {
      throw new OrdinarySessionDirectoryError("session-not-ordinary", "Project Agent Sessions are managed by their Project.");
    }
    const record = this.entries.get(sessionId);
    if (record === undefined) throw new OrdinarySessionDirectoryError("session-not-found", "Ordinary Session was not found.");
    return record;
  }

  private migrate(ctx: Context): void {
    const recovered = [...ctx.storage.recovery.sessions].filter(([id, history]) =>
      history.projectId === null && resolveAgentBinding(ctx, createSessionId(id)) === undefined);
    if (recovered.length === 0) return;
    ctx.storage.atomic(tx => {
      const existing = new Set(tx.listOrdinarySessions().map(record => record.sessionId));
      for (const [id, history] of recovered) {
        if (existing.has(id)) continue;
        const events = ctx.sessions.getEvents(createSessionId(id));
        const now = new Date().toISOString();
        tx.insertOrdinarySession({
          sessionId: id,
          title: DEFAULT_SESSION_TITLE,
          archived: false,
          createdAt: events[0]?.timestamp ?? now,
          updatedAt: events.at(-1)?.timestamp ?? now,
          revision: tx.nextOrdinarySessionRevision(),
        });
        existing.add(id);
      }
    });
  }

  private catalogRevision(): number {
    let revision = 0;
    for (const record of this.entries.values()) revision = Math.max(revision, record.revision);
    return revision;
  }

  private write<T>(work: (tx: StorageTransaction) => T): T {
    return this.ctx.storage.atomic(work);
  }

  private requireAvailable(): void {
    if (this.unavailable) throw new OrdinarySessionDirectoryError("session-unavailable", "Session directory is unavailable.");
  }
}

export function beginOrdinaryActivity(
  ctx: Context,
  sessionId: SessionId,
): (() => void) | undefined {
  const directory = (ctx as Context & { readonly sessionDirectory?: OrdinarySessionDirectory }).sessionDirectory;
  return directory?.beginActivity(sessionId);
}

function snapshot(record: OrdinarySessionRecord): OrdinarySessionSnapshot {
  return Object.freeze({
    sessionId: createSessionId(record.sessionId), title: record.title,
    status: record.archived ? "archived" : "active",
    createdAt: record.createdAt, updatedAt: record.updatedAt, revision: record.revision,
  });
}

function compareRecords(left: OrdinarySessionRecord, right: OrdinarySessionRecord): number {
  if (right.createdAt < left.createdAt) return -1;
  if (right.createdAt > left.createdAt) return 1;
  return left.sessionId < right.sessionId ? -1 : left.sessionId > right.sessionId ? 1 : 0;
}

function normalizeTitle(value: string | undefined): string {
  if (value === undefined) return DEFAULT_SESSION_TITLE;
  const title = value.trim();
  if (!title || title.length > SESSION_TITLE_MAX_CHARS) {
    throw new OrdinarySessionDirectoryError("session-invalid-title", `Session title must be 1-${SESSION_TITLE_MAX_CHARS} characters.`);
  }
  return title;
}
