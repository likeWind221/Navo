import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { StorageError } from "./errors.js";

export const STORAGE_SCHEMA_VERSION = 1;
export const STORAGE_APPLICATION_ID = 0x4e41564f;

const SCHEMA = `
CREATE TABLE events (
  domain     TEXT    NOT NULL,
  owner_id   TEXT    NOT NULL,
  seq        INTEGER NOT NULL CHECK (seq >= 1),
  project_id TEXT    NOT NULL,
  payload    TEXT    NOT NULL,
  PRIMARY KEY (domain, owner_id, seq)
) STRICT;
CREATE INDEX events_by_project ON events (project_id, domain, owner_id, seq);
CREATE TABLE workspace_bindings (
  project_id TEXT PRIMARY KEY,
  root       TEXT NOT NULL UNIQUE
) STRICT;
PRAGMA application_id = ${STORAGE_APPLICATION_ID};
PRAGMA user_version = ${STORAGE_SCHEMA_VERSION};
`;

const REQUIRED_TABLES = ["events", "workspace_bindings"];

export function openDatabase(path: string): DatabaseSync {
  const { DatabaseSync } = loadSqlite();
  let db: DatabaseSync | undefined;
  try {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    db = new DatabaseSync(path);
    configureDatabase(db, path);
    return db;
  } catch (error: unknown) {
    if (db?.isOpen) db.close();
    if (error instanceof StorageError) throw error;
    throw new StorageError("storage-unavailable", `Navo database at "${path}" could not be opened.`, {
      cause: error,
    });
  }
}

function configureDatabase(db: DatabaseSync, path: string): void {
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec("PRAGMA trusted_schema = OFF");
  if (path !== ":memory:" && pragma(db, "journal_mode = WAL", "journal_mode") !== "wal") {
    throw new StorageError("storage-unavailable", `Navo database at "${path}" could not enable WAL.`);
  }
  db.exec("PRAGMA synchronous = FULL");
  db.exec("BEGIN IMMEDIATE");
  try {
    const version = pragma(db, "user_version", "user_version");
    const applicationId = pragma(db, "application_id", "application_id");
    if (version === 0) {
      const objects = db.prepare(
        "SELECT count(*) AS count FROM sqlite_schema WHERE name NOT LIKE 'sqlite_%'",
      ).get()?.count;
      if (applicationId !== 0 || objects !== 0) {
        throw unsupported(path, "has an unversioned schema or a foreign application id");
      }
      db.exec(SCHEMA);
    } else if (version !== STORAGE_SCHEMA_VERSION || applicationId !== STORAGE_APPLICATION_ID) {
      throw unsupported(path, `has schema ${String(version)} / application id ${String(applicationId)}`);
    } else {
      const tables = db.prepare(
        `SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN (${REQUIRED_TABLES.map(() => "?").join(", ")})`,
      ).all(...REQUIRED_TABLES);
      if (tables.length !== REQUIRED_TABLES.length) throw unsupported(path, "is missing required tables");
    }
    db.exec("COMMIT");
  } catch (error: unknown) {
    if (db.isTransaction) db.exec("ROLLBACK");
    throw error;
  }
}

function loadSqlite(): typeof import("node:sqlite") {
  const emitWarning = process.emitWarning;
  process.emitWarning = ((warning: string | Error, ...args: unknown[]) => {
    if (isSqliteWarning(warning, args[0])) return;
    Reflect.apply(emitWarning, process, [warning, ...args]);
  }) as typeof process.emitWarning;
  try {
    return process.getBuiltinModule("node:sqlite") as typeof import("node:sqlite");
  } finally {
    process.emitWarning = emitWarning;
  }
}

function isSqliteWarning(warning: string | Error, option: unknown): boolean {
  const message = warning instanceof Error ? warning.message : warning;
  const type = warning instanceof Error ? warning.name
    : typeof option === "string" ? option
      : typeof option === "object" && option !== null && "type" in option ? option.type
        : undefined;
  return type === "ExperimentalWarning" && message.startsWith("SQLite is an experimental feature");
}

function pragma(db: DatabaseSync, statement: string, column: string): SQLInputValue | undefined {
  return db.prepare(`PRAGMA ${statement}`).get()?.[column];
}

function unsupported(path: string, reason: string): StorageError {
  return new StorageError("schema-unsupported", `Navo database at "${path}" ${reason}.`);
}
