import type { DatabaseSync } from "node:sqlite";
import type { ActiveChunkRecord } from "./indexing.js";

export interface RetrievalTransaction {
  scanSearchChunks(input: SearchChunkQuery): readonly ActiveChunkRecord[];
  getSearchChunk(projectId: string, chunkId: string, chunkerVersion: string): ActiveChunkRecord | undefined;
}

export interface SearchChunkQuery {
  readonly projectId: string;
  readonly resourceIds: readonly string[];
  readonly chunkerVersion: string;
  readonly afterChunkId: string | null;
  readonly limit: number;
}

const currentChunks = `SELECT c.*, b.project_id, b.resource_id, b.source_asset_generation, b.embedding_provider,
  b.embedding_model, b.embedding_revision, b.embedding_dimension, b.document_template_version,
  b.query_template_version, b.vector_encoding_version
  FROM resource_chunks c JOIN resource_index_builds b ON b.build_id = c.build_id
  JOIN resource_content body ON body.project_id = b.project_id AND body.resource_id = b.resource_id
  WHERE b.project_id = ? AND b.status = 'active' AND b.chunker_version = ?
    AND body.status = 'ready' AND body.source_asset_generation = b.source_asset_generation`;

export function retrievalTransaction(db: DatabaseSync): RetrievalTransaction {
  return {
    scanSearchChunks(input) {
      if (input.resourceIds.length === 0) return [];
      return db.prepare(`${currentChunks} AND b.resource_id IN (${input.resourceIds.map(() => "?").join(",")})
        AND c.chunk_id > ? ORDER BY c.chunk_id LIMIT ?`)
        .all(input.projectId, input.chunkerVersion, ...input.resourceIds, input.afterChunkId ?? "", input.limit) as unknown as ActiveChunkRecord[];
    },
    getSearchChunk(projectId, chunkId, chunkerVersion) {
      return db.prepare(`${currentChunks} AND c.chunk_id = ?`).get(projectId, chunkerVersion, chunkId) as unknown as ActiveChunkRecord | undefined;
    },
  };
}
