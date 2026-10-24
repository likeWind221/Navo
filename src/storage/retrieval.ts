import type { DatabaseSync } from "node:sqlite";
import type { ActiveChunkRecord } from "./indexing.js";

export interface RetrievalTransaction {
  getSearchChunk(projectId: string, chunkId: string, chunkerVersion: string): ActiveChunkRecord | undefined;
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
    getSearchChunk(projectId, chunkId, chunkerVersion) {
      return db.prepare(`${currentChunks} AND c.chunk_id = ?`).get(projectId, chunkerVersion, chunkId) as unknown as ActiveChunkRecord | undefined;
    },
  };
}
