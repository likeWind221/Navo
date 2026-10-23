import type { DatabaseSync, SQLInputValue } from "node:sqlite";

export type IndexBuildStatus = "building" | "active" | "failed" | "superseded";

export interface ResourceIndexBuildRecord {
  readonly build_id: string;
  readonly project_id: string;
  readonly resource_id: string;
  readonly source_asset_generation: number;
  readonly status: IndexBuildStatus;
  readonly chunker_version: string;
  readonly embedding_provider: string;
  readonly embedding_model: string;
  readonly embedding_revision: string | null;
  readonly embedding_dimension: number;
  readonly document_template_version: string;
  readonly query_template_version: string;
  readonly vector_encoding_version: string;
  readonly expected_chunk_count: number;
  readonly attempt_count: number;
  readonly error_code: string | null;
  readonly error_message: string | null;
  readonly created_at: string;
  readonly updated_at: string;
}

export interface ResourceChunkRecord {
  readonly chunk_id: string;
  readonly build_id: string;
  readonly ordinal: number;
  readonly text: string;
  readonly embedding_text: string;
  readonly start_offset_utf16: number;
  readonly end_offset_utf16: number;
  readonly heading_path_json: string;
  readonly structure: string;
  readonly page_map_json: string;
  readonly embedding: Uint8Array | null;
}

export interface ActiveChunkRecord extends ResourceChunkRecord {
  readonly project_id: string;
  readonly resource_id: string;
  readonly source_asset_generation: number;
  readonly embedding_provider: string;
  readonly embedding_model: string;
  readonly embedding_revision: string | null;
  readonly embedding_dimension: number;
  readonly document_template_version: string;
  readonly query_template_version: string;
  readonly vector_encoding_version: string;
}

export interface ResourceIndexTransaction {
  getIndexBuild(buildId: string): ResourceIndexBuildRecord | undefined;
  listIndexBuilds(status?: IndexBuildStatus): readonly ResourceIndexBuildRecord[];
  createIndexBuild(build: ResourceIndexBuildRecord, chunks: readonly ResourceChunkRecord[]): void;
  listBuildChunks(buildId: string): readonly ResourceChunkRecord[];
  listPendingChunks(buildId: string, limit: number): readonly ResourceChunkRecord[];
  writeChunkEmbeddings(buildId: string, values: readonly { readonly chunkId: string; readonly embedding: Uint8Array }[]): boolean;
  incrementIndexAttempt(buildId: string): void;
  failIndexBuild(buildId: string, code: string, message: string): boolean;
  supersedeIndexBuild(buildId: string): boolean;
  publishIndexBuild(buildId: string): boolean;
  listActiveChunks(input: ActiveChunkQuery): readonly ActiveChunkRecord[];
}

export interface ActiveChunkQuery {
  readonly projectId: string;
  readonly resourceIds: readonly string[];
  readonly provider: string;
  readonly model: string;
  readonly revision: string | null;
  readonly dimension: number;
  readonly documentTemplateVersion: string;
  readonly queryTemplateVersion: string;
  readonly encodingVersion: string;
  readonly afterChunkId: string | null;
  readonly limit: number;
}

export const RESOURCE_INDEX_SCHEMA = `
CREATE TABLE resource_index_builds (
  build_id TEXT PRIMARY KEY CHECK (length(trim(build_id)) > 0),
  project_id TEXT NOT NULL CHECK (length(trim(project_id)) > 0),
  resource_id TEXT NOT NULL CHECK (length(trim(resource_id)) > 0),
  source_asset_generation INTEGER NOT NULL CHECK (source_asset_generation >= 1),
  status TEXT NOT NULL CHECK (status IN ('building', 'active', 'failed', 'superseded')),
  chunker_version TEXT NOT NULL,
  embedding_provider TEXT NOT NULL,
  embedding_model TEXT NOT NULL,
  embedding_revision TEXT,
  embedding_dimension INTEGER NOT NULL CHECK (embedding_dimension >= 1),
  document_template_version TEXT NOT NULL,
  query_template_version TEXT NOT NULL,
  vector_encoding_version TEXT NOT NULL,
  expected_chunk_count INTEGER NOT NULL CHECK (expected_chunk_count >= 0),
  attempt_count INTEGER NOT NULL CHECK (attempt_count >= 0),
  error_code TEXT,
  error_message TEXT CHECK (error_message IS NULL OR length(error_message) <= 1000),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
CREATE INDEX resource_index_builds_by_resource ON resource_index_builds (project_id, resource_id, created_at);
CREATE UNIQUE INDEX resource_index_one_active ON resource_index_builds (project_id, resource_id) WHERE status = 'active';
CREATE UNIQUE INDEX resource_index_one_building ON resource_index_builds (project_id, resource_id) WHERE status = 'building';
CREATE TABLE resource_chunks (
  chunk_id TEXT PRIMARY KEY CHECK (length(trim(chunk_id)) > 0),
  build_id TEXT NOT NULL REFERENCES resource_index_builds(build_id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL CHECK (ordinal >= 0),
  text TEXT NOT NULL,
  embedding_text TEXT NOT NULL,
  start_offset_utf16 INTEGER NOT NULL CHECK (start_offset_utf16 >= 0),
  end_offset_utf16 INTEGER NOT NULL CHECK (end_offset_utf16 >= start_offset_utf16),
  heading_path_json TEXT NOT NULL CHECK (json_valid(heading_path_json) AND json_type(heading_path_json) = 'array'),
  structure TEXT NOT NULL CHECK (structure IN ('heading', 'paragraph', 'list', 'code', 'table', 'mixed')),
  page_map_json TEXT NOT NULL CHECK (json_valid(page_map_json) AND json_type(page_map_json) = 'array'),
  embedding BLOB,
  UNIQUE (build_id, ordinal)
) STRICT;
CREATE INDEX resource_chunks_by_build ON resource_chunks (build_id, ordinal);
`;

const buildColumns = ["build_id", "project_id", "resource_id", "source_asset_generation", "status", "chunker_version",
  "embedding_provider", "embedding_model", "embedding_revision", "embedding_dimension", "document_template_version",
  "query_template_version", "vector_encoding_version", "expected_chunk_count", "attempt_count", "error_code", "error_message",
  "created_at", "updated_at"] as const;
const chunkColumns = ["chunk_id", "build_id", "ordinal", "text", "embedding_text", "start_offset_utf16", "end_offset_utf16",
  "heading_path_json", "structure", "page_map_json", "embedding"] as const;

export function resourceIndexTransaction(db: DatabaseSync): ResourceIndexTransaction {
  return {
    getIndexBuild(buildId) {
      return db.prepare("SELECT * FROM resource_index_builds WHERE build_id = ?").get(buildId) as unknown as ResourceIndexBuildRecord | undefined;
    },
    listIndexBuilds(status) {
      return (status === undefined
        ? db.prepare("SELECT * FROM resource_index_builds ORDER BY created_at, build_id").all()
        : db.prepare("SELECT * FROM resource_index_builds WHERE status = ? ORDER BY created_at, build_id").all(status)) as unknown as ResourceIndexBuildRecord[];
    },
    createIndexBuild(build, chunks) {
      db.prepare(`INSERT INTO resource_index_builds (${buildColumns.join(",")}) VALUES (${buildColumns.map(() => "?").join(",")})`)
        .run(...buildColumns.map(key => build[key]) as SQLInputValue[]);
      const insert = db.prepare(`INSERT INTO resource_chunks (${chunkColumns.join(",")}) VALUES (${chunkColumns.map(() => "?").join(",")})`);
      for (const chunk of chunks) insert.run(...chunkColumns.map(key => chunk[key]) as SQLInputValue[]);
    },
    listBuildChunks(buildId) {
      return db.prepare("SELECT * FROM resource_chunks WHERE build_id = ? ORDER BY ordinal").all(buildId) as unknown as ResourceChunkRecord[];
    },
    listPendingChunks(buildId, limit) {
      return db.prepare("SELECT * FROM resource_chunks WHERE build_id = ? AND embedding IS NULL ORDER BY ordinal LIMIT ?")
        .all(buildId, limit) as unknown as ResourceChunkRecord[];
    },
    writeChunkEmbeddings(buildId, values) {
      if (values.length === 0) return true;
      const placeholders = values.map(() => "?").join(",");
      const available = db.prepare(`SELECT count(*) AS count FROM resource_chunks WHERE build_id = ? AND embedding IS NULL AND chunk_id IN (${placeholders})`)
        .get(buildId, ...values.map(value => value.chunkId));
      if (Number(available?.count) !== values.length || new Set(values.map(value => value.chunkId)).size !== values.length) return false;
      const update = db.prepare("UPDATE resource_chunks SET embedding = ? WHERE build_id = ? AND chunk_id = ? AND embedding IS NULL");
      for (const value of values) update.run(value.embedding, buildId, value.chunkId);
      return true;
    },
    incrementIndexAttempt(buildId) {
      db.prepare("UPDATE resource_index_builds SET attempt_count = attempt_count + 1, updated_at = ? WHERE build_id = ? AND status = 'building'")
        .run(new Date().toISOString(), buildId);
    },
    failIndexBuild(buildId, code, message) {
      return db.prepare("UPDATE resource_index_builds SET status = 'failed', error_code = ?, error_message = ?, updated_at = ? WHERE build_id = ? AND status = 'building'")
        .run(code, message.slice(0, 1000), new Date().toISOString(), buildId).changes === 1;
    },
    supersedeIndexBuild(buildId) {
      return db.prepare("UPDATE resource_index_builds SET status = 'superseded', updated_at = ? WHERE build_id = ? AND status IN ('building', 'active')")
        .run(new Date().toISOString(), buildId).changes === 1;
    },
    publishIndexBuild(buildId) {
      const build = db.prepare("SELECT * FROM resource_index_builds WHERE build_id = ? AND status = 'building'").get(buildId) as unknown as ResourceIndexBuildRecord | undefined;
      if (build === undefined) return false;
      const content = db.prepare("SELECT status, source_asset_generation FROM resource_content WHERE project_id = ? AND resource_id = ?")
        .get(build.project_id, build.resource_id);
      if (content?.status !== "ready" || content.source_asset_generation !== build.source_asset_generation) return false;
      const count = db.prepare("SELECT count(*) AS total, sum(embedding IS NULL) AS pending, min(length(embedding)) AS minimum, max(length(embedding)) AS maximum FROM resource_chunks WHERE build_id = ?")
        .get(buildId);
      const bytes = build.embedding_dimension * 4;
      if (Number(count?.total) !== build.expected_chunk_count || Number(count?.pending ?? 0) !== 0
        || (build.expected_chunk_count > 0 && (Number(count?.minimum) !== bytes || Number(count?.maximum) !== bytes))) return false;
      db.prepare("UPDATE resource_index_builds SET status = 'superseded', updated_at = ? WHERE project_id = ? AND resource_id = ? AND status = 'active'")
        .run(new Date().toISOString(), build.project_id, build.resource_id);
      return db.prepare("UPDATE resource_index_builds SET status = 'active', error_code = NULL, error_message = NULL, updated_at = ? WHERE build_id = ? AND status = 'building'")
        .run(new Date().toISOString(), buildId).changes === 1;
    },
    listActiveChunks(input) {
      if (input.resourceIds.length === 0) return [];
      const placeholders = input.resourceIds.map(() => "?").join(",");
      return db.prepare(`SELECT c.*, b.project_id, b.resource_id, b.source_asset_generation, b.embedding_provider,
          b.embedding_model, b.embedding_revision, b.embedding_dimension, b.document_template_version,
          b.query_template_version, b.vector_encoding_version
        FROM resource_chunks c JOIN resource_index_builds b ON b.build_id = c.build_id
        WHERE b.status = 'active' AND b.project_id = ? AND b.resource_id IN (${placeholders})
          AND b.embedding_provider = ? AND b.embedding_model = ? AND b.embedding_revision IS ?
          AND b.embedding_dimension = ? AND b.document_template_version = ? AND b.query_template_version = ?
          AND b.vector_encoding_version = ? AND c.embedding IS NOT NULL AND c.chunk_id > ?
        ORDER BY c.chunk_id LIMIT ?`).all(input.projectId, ...input.resourceIds, input.provider, input.model, input.revision,
          input.dimension, input.documentTemplateVersion, input.queryTemplateVersion, input.encodingVersion,
          input.afterChunkId ?? "", input.limit) as unknown as ActiveChunkRecord[];
    },
  };
}
