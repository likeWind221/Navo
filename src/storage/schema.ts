import { GRAPH_SCHEMA } from "./graph/schema.js";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { DatabaseSync, SQLInputValue } from "node:sqlite";

import { RESOURCE_CONTENT_SCHEMA } from "./content.js";
import { FILE_OPERATIONS_SCHEMA } from "./operations.js";
import { StorageError } from "./errors.js";
import { LIBRARY_FOLDERS_SCHEMA } from "./folders.js";
import { RESOURCE_INDEX_SCHEMA } from "./indexing.js";
import { RESOURCE_CATALOG_SCHEMA } from "./catalog.js";

export const STORAGE_SCHEMA_VERSION = 8;
export const STORAGE_APPLICATION_ID = 0x4e41564f;

export const EVENT_HISTORY_QUERY =
  "SELECT owner_id, seq, project_id, payload FROM events WHERE domain = ? ORDER BY min(rowid) OVER (PARTITION BY owner_id), seq";

const EVENTS_SCHEMA = `
CREATE TABLE events (
  domain     TEXT    NOT NULL,
  owner_id   TEXT    NOT NULL,
  seq        INTEGER NOT NULL CHECK (seq >= 1),
  project_id TEXT CHECK (domain = 'session' OR project_id IS NOT NULL),
  payload    TEXT    NOT NULL,
  PRIMARY KEY (domain, owner_id, seq)
) STRICT;
CREATE INDEX events_by_project ON events (project_id, domain, owner_id, seq);
`;

const SCHEMA = `${EVENTS_SCHEMA}
${FILE_OPERATIONS_SCHEMA}
${RESOURCE_CONTENT_SCHEMA}
${LIBRARY_FOLDERS_SCHEMA}
${RESOURCE_INDEX_SCHEMA}
${GRAPH_SCHEMA}
${RESOURCE_CATALOG_SCHEMA}
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
  db.exec("PRAGMA foreign_keys = ON");
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
    } else if (![1, 2, 3, 4, 5, 6, 7, STORAGE_SCHEMA_VERSION].includes(Number(version)) || applicationId !== STORAGE_APPLICATION_ID) {
      throw unsupported(path, `has schema ${String(version)} / application id ${String(applicationId)}`);
    } else {
      const requiredTables = [...REQUIRED_TABLES, ...(Number(version) >= 3 ? ["resource_file_operations"] : []), ...(Number(version) >= 4 ? ["resource_content"] : []), ...(Number(version) >= 5 ? ["library_folders"] : []), ...(Number(version) >= 6 ? ["resource_index_builds", "resource_chunks"] : []), ...(Number(version) >= 7 ? ["graph_builds", "graph_entities", "graph_relations", "graph_evidence"] : []), ...(Number(version) >= 8 ? ["resource_catalog_versions"] : [])];
      const tables = db.prepare(
        `SELECT name FROM sqlite_schema WHERE type = 'table' AND name IN (${requiredTables.map(() => "?").join(", ")})`,
      ).all(...requiredTables);
      if (tables.length !== requiredTables.length) throw unsupported(path, "is missing required tables");
      if (version === 1) {
        db.exec(`
          DROP INDEX events_by_project;
          ALTER TABLE events RENAME TO events_v1;
          ${EVENTS_SCHEMA}
          INSERT INTO events SELECT domain, owner_id, seq, project_id, payload FROM events_v1;
          DROP TABLE events_v1;
          PRAGMA user_version = 2;
        `);
      }
      if (version === 1 || version === 2) {
        db.exec(`${FILE_OPERATIONS_SCHEMA} PRAGMA user_version = 3;`);
      }
      if (Number(version) < 4) db.exec(`${RESOURCE_CONTENT_SCHEMA} PRAGMA user_version = 4;`);
      if (Number(version) < 5) db.exec(`${LIBRARY_FOLDERS_SCHEMA} PRAGMA user_version = 5;`);
      if (Number(version) < 6) db.exec(`${RESOURCE_INDEX_SCHEMA} PRAGMA user_version = 6;`);
      if (Number(version) < 7) db.exec(`${GRAPH_SCHEMA} PRAGMA user_version = 7;`);
      if (Number(version) < 8) db.exec(`${RESOURCE_CATALOG_SCHEMA} PRAGMA user_version = 8;`);
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
