import type { DatabaseSync } from "node:sqlite";

export interface OrdinarySessionRecord {
  readonly sessionId: string;
  readonly title: string;
  readonly archived: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly revision: number;
}

export interface OrdinarySessionTransaction {
  listOrdinarySessions(): readonly OrdinarySessionRecord[];
  getOrdinarySession(sessionId: string): OrdinarySessionRecord | undefined;
  insertOrdinarySession(record: OrdinarySessionRecord): void;
  updateOrdinarySession(record: OrdinarySessionRecord): void;
  nextOrdinarySessionRevision(): number;
}

export const ORDINARY_SESSION_SCHEMA = `
CREATE TABLE IF NOT EXISTS ordinary_sessions (
  session_id TEXT PRIMARY KEY CHECK (length(trim(session_id)) > 0),
  title TEXT NOT NULL CHECK (length(trim(title)) > 0 AND length(title) <= 200),
  archived INTEGER NOT NULL CHECK (archived IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision >= 1)
) STRICT;
CREATE INDEX IF NOT EXISTS ordinary_sessions_order ON ordinary_sessions (created_at DESC, session_id ASC);
`;

export function ordinarySessionTransaction(db: DatabaseSync): OrdinarySessionTransaction {
  const read = (row: unknown): OrdinarySessionRecord => {
    if (!isRecord(row) || typeof row.session_id !== "string" || typeof row.title !== "string"
      || (row.archived !== 0 && row.archived !== 1) || typeof row.created_at !== "string"
      || typeof row.updated_at !== "string" || !Number.isSafeInteger(row.revision)
      || (row.revision as number) < 1) {
      throw new Error("Stored ordinary Session metadata is invalid.");
    }
    return {
      sessionId: row.session_id,
      title: row.title,
      archived: row.archived === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
      revision: row.revision as number,
    };
  };
  return {
    listOrdinarySessions() {
      return Object.freeze(db.prepare("SELECT * FROM ordinary_sessions").all().map(read));
    },
    getOrdinarySession(sessionId) {
      const row = db.prepare("SELECT * FROM ordinary_sessions WHERE session_id = ?").get(sessionId);
      return row === undefined ? undefined : read(row);
    },
    insertOrdinarySession(record) {
      db.prepare("INSERT INTO ordinary_sessions (session_id, title, archived, created_at, updated_at, revision) VALUES (?, ?, ?, ?, ?, ?)")
        .run(record.sessionId, record.title, record.archived ? 1 : 0, record.createdAt, record.updatedAt, record.revision);
    },
    updateOrdinarySession(record) {
      const result = db.prepare("UPDATE ordinary_sessions SET title = ?, archived = ?, created_at = ?, updated_at = ?, revision = ? WHERE session_id = ?")
        .run(record.title, record.archived ? 1 : 0, record.createdAt, record.updatedAt, record.revision, record.sessionId);
      if (result.changes !== 1) throw new Error("Ordinary Session metadata was not found.");
    },
    nextOrdinarySessionRevision() {
      const row = db.prepare("SELECT max(revision) AS revision FROM ordinary_sessions").get();
      const revision = isRecord(row) && row.revision === null ? 0 : isRecord(row) ? row.revision : undefined;
      if (!Number.isSafeInteger(revision) || (revision as number) < 0) {
        throw new Error("Stored ordinary Session revision is invalid.");
      }
      return (revision as number) + 1;
    },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
