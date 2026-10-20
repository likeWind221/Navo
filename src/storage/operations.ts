import type { DatabaseSync, SQLInputValue } from "node:sqlite";

export interface FileOperation {
  readonly operation_id: string;
  readonly project_id: string;
  readonly resource_id: string | null;
  readonly operation_kind: "create" | "replace" | "delete";
  readonly request_json: string;
  readonly execution_state: "staging" | "prepared" | "committed" | "cleanup_pending" | "completed" | "failed" | "cancelled";
  readonly business_result: "pending" | "succeeded" | "failed" | "cancelled";
  readonly base_revision: number;
  readonly source_generation: number | null;
  readonly target_generation: number | null;
  readonly staging_relpath: string | null;
  readonly target_relpath: string | null;
  readonly cleanup_targets_json: string;
  readonly error_code: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface FileOperationTransaction {
  insertFileOperation(operation: FileOperation): void;
  updateFileOperation(operation: FileOperation): void;
  getFileOperation(operationId: string): FileOperation | undefined;
  pendingFileOperations(): readonly FileOperation[];
  deleteFileOperation(operationId: string): void;
}

export const FILE_OPERATIONS_SCHEMA = `
CREATE TABLE resource_file_operations (
  operation_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  resource_id TEXT,
  operation_kind TEXT NOT NULL CHECK (operation_kind IN ('create', 'replace', 'delete')),
  request_json TEXT NOT NULL CHECK (json_valid(request_json)),
  execution_state TEXT NOT NULL CHECK (execution_state IN ('staging', 'prepared', 'committed', 'cleanup_pending', 'completed', 'failed', 'cancelled')),
  business_result TEXT NOT NULL CHECK (business_result IN ('pending', 'succeeded', 'failed', 'cancelled')),
  base_revision INTEGER NOT NULL CHECK (base_revision >= 0),
  source_generation INTEGER CHECK (source_generation >= 1),
  target_generation INTEGER CHECK (target_generation >= 1),
  staging_relpath TEXT,
  target_relpath TEXT,
  cleanup_targets_json TEXT NOT NULL CHECK (json_valid(cleanup_targets_json) AND json_type(cleanup_targets_json) = 'array'),
  error_code TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (operation_kind = 'create' OR resource_id IS NOT NULL),
  CHECK ((operation_kind = 'create' AND base_revision = 0 AND source_generation IS NULL AND target_generation IS NOT NULL AND target_generation = 1)
    OR (operation_kind = 'replace' AND base_revision >= 1 AND source_generation IS NOT NULL AND target_generation IS NOT NULL AND target_generation = source_generation + 1)
    OR (operation_kind = 'delete' AND base_revision >= 1 AND source_generation IS NOT NULL AND target_generation IS NULL)),
  CHECK (execution_state NOT IN ('staging', 'prepared') OR business_result = 'pending'),
  CHECK (execution_state NOT IN ('prepared', 'committed', 'completed') OR resource_id IS NOT NULL),
  CHECK (execution_state NOT IN ('committed', 'completed') OR business_result = 'succeeded'),
  CHECK (execution_state != 'failed' OR business_result = 'failed'),
  CHECK (execution_state != 'cancelled' OR business_result = 'cancelled'),
  CHECK (execution_state NOT IN ('completed', 'failed', 'cancelled') OR cleanup_targets_json = '[]')
) STRICT;
CREATE INDEX resource_operations_pending ON resource_file_operations (execution_state, project_id);
CREATE INDEX resource_operations_resource ON resource_file_operations (project_id, resource_id);
CREATE UNIQUE INDEX resource_operations_generation ON resource_file_operations (resource_id, target_generation)
  WHERE target_generation IS NOT NULL AND execution_state NOT IN ('failed', 'cancelled');
`;

export function fileOperationTransaction(db: DatabaseSync): FileOperationTransaction {
  return {
    insertFileOperation(operation) {
      const keys = Object.keys(operation);
      db.prepare(`INSERT INTO resource_file_operations (${keys.join(",")}) VALUES (${keys.map(() => "?").join(",")})`)
        .run(...Object.values(operation) as SQLInputValue[]);
    },
    updateFileOperation(operation) {
      const previous = db.prepare("SELECT * FROM resource_file_operations WHERE operation_id = ?").get(operation.operation_id);
      if (previous === undefined || previous.project_id !== operation.project_id || previous.operation_kind !== operation.operation_kind
        || previous.request_json !== operation.request_json || previous.created_at !== operation.created_at
        || (previous.resource_id !== null && previous.resource_id !== operation.resource_id)) throw new Error("File operation identity cannot change.");
      for (const key of ["base_revision", "source_generation", "target_generation", "staging_relpath"] as const) {
        if (previous[key] !== operation[key]) throw new Error("File operation targets cannot change.");
      }
      if (previous.target_relpath !== null && previous.target_relpath !== operation.target_relpath) throw new Error("Prepared target cannot change.");
      const { operation_id, ...fields } = operation;
      const result = db.prepare(`UPDATE resource_file_operations SET ${Object.keys(fields).map(key => `${key} = ?`).join(",")} WHERE operation_id = ?`)
        .run(...Object.values(fields) as SQLInputValue[], operation_id);
      if (result.changes !== 1) throw new Error("File operation does not exist.");
    },
    getFileOperation(operationId) {
      return db.prepare("SELECT * FROM resource_file_operations WHERE operation_id = ?").get(operationId) as unknown as FileOperation | undefined;
    },
    pendingFileOperations() {
      return db.prepare("SELECT * FROM resource_file_operations WHERE execution_state NOT IN ('completed', 'failed', 'cancelled') ORDER BY created_at, operation_id").all() as unknown as FileOperation[];
    },
    deleteFileOperation(operationId) {
      db.prepare("DELETE FROM resource_file_operations WHERE operation_id = ? AND execution_state IN ('completed', 'failed', 'cancelled')").run(operationId);
    },
  };
}
