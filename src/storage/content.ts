import type { DatabaseSync, SQLInputValue } from "node:sqlite";

export interface ResourceContentTransaction {
  getResourceContent(projectId: string, resourceId: string): ResourceContentRecord | undefined;
  listResourceContent(projectId?: string): readonly ResourceContentRecord[];
  putResourceContent(record: ResourceContentRecord): void;
  claimResourceContent(projectId: string, resourceId: string, generation: number, attemptId: string): boolean;
  finishResourceContent(record: ResourceContentRecord, attemptId: string): boolean;
  deleteResourceContent(projectId: string, resourceId: string): void;
}

export interface ResourceContentRecord {
  readonly project_id: string;
  readonly resource_id: string;
  readonly source_asset_generation: number;
  readonly status: "pending" | "processing" | "ready" | "metadata_only" | "failed";
  readonly body: string | null;
  readonly page_map_json: string | null;
  readonly extractor_version: string | null;
  readonly processing_attempt_id: string | null;
  readonly error_code: string | null;
  readonly error_message: string | null;
  readonly updated_at: string;
}

export const RESOURCE_CONTENT_SCHEMA = `
CREATE TABLE resource_content (
  project_id TEXT NOT NULL CHECK (length(trim(project_id)) > 0),
  resource_id TEXT NOT NULL CHECK (length(trim(resource_id)) > 0),
  source_asset_generation INTEGER NOT NULL CHECK (source_asset_generation >= 1),
  status TEXT NOT NULL CHECK (status IN ('pending', 'processing', 'ready', 'metadata_only', 'failed')),
  body TEXT,
  page_map_json TEXT CHECK (page_map_json IS NULL OR (json_valid(page_map_json) AND json_type(page_map_json) = 'array')),
  extractor_version TEXT,
  processing_attempt_id TEXT,
  error_code TEXT,
  error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 1000),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (project_id, resource_id),
  CHECK ((status = 'ready' AND body IS NOT NULL AND length(trim(body)) > 0 AND extractor_version IS NOT NULL)
    OR (status != 'ready' AND body IS NULL)),
  CHECK ((status = 'processing' AND processing_attempt_id IS NOT NULL AND length(trim(processing_attempt_id)) > 0)
    OR (status != 'processing' AND processing_attempt_id IS NULL)),
  CHECK (status != 'failed' OR error_code IS NOT NULL),
  CHECK (status = 'ready' OR (page_map_json IS NULL AND extractor_version IS NULL))
) STRICT;
CREATE INDEX resource_content_by_project_status ON resource_content (project_id, status, updated_at);
`;

const columns = ["project_id", "resource_id", "source_asset_generation", "status", "body", "page_map_json",
  "extractor_version", "processing_attempt_id", "error_code", "error_message", "updated_at"] as const;

export function resourceContentTransaction(db: DatabaseSync): ResourceContentTransaction {
  const values = (record: ResourceContentRecord): SQLInputValue[] => columns.map(key => record[key]);
  return {
    getResourceContent(projectId, resourceId) {
      return db.prepare("SELECT * FROM resource_content WHERE project_id = ? AND resource_id = ?")
        .get(projectId, resourceId) as unknown as ResourceContentRecord | undefined;
    },
    listResourceContent(projectId) {
      return (projectId === undefined
        ? db.prepare("SELECT * FROM resource_content ORDER BY project_id, updated_at, resource_id").all()
        : db.prepare("SELECT * FROM resource_content WHERE project_id = ? ORDER BY updated_at, resource_id").all(projectId)) as unknown as ResourceContentRecord[];
    },
    putResourceContent(record) {
      db.prepare(`INSERT INTO resource_content (${columns.join(",")}) VALUES (${columns.map(() => "?").join(",")})
        ON CONFLICT(project_id, resource_id) DO UPDATE SET ${columns.slice(2).map(key => `${key}=excluded.${key}`).join(",")}`)
        .run(...values(record));
    },
    claimResourceContent(projectId, resourceId, generation, attemptId) {
      return db.prepare(`UPDATE resource_content SET status = 'processing', processing_attempt_id = ?, updated_at = ?
        WHERE project_id = ? AND resource_id = ? AND source_asset_generation = ? AND status = 'pending'`)
        .run(attemptId, new Date().toISOString(), projectId, resourceId, generation).changes === 1;
    },
    finishResourceContent(record, attemptId) {
      return db.prepare(`UPDATE resource_content SET ${columns.slice(2).map(key => `${key}=?`).join(",")}
        WHERE project_id = ? AND resource_id = ? AND source_asset_generation = ? AND status = 'processing' AND processing_attempt_id = ?`)
        .run(...values(record).slice(2), record.project_id, record.resource_id, record.source_asset_generation, attemptId).changes === 1;
    },
    deleteResourceContent(projectId, resourceId) {
      db.prepare("DELETE FROM resource_content WHERE project_id = ? AND resource_id = ?").run(projectId, resourceId);
    },
  };
}
