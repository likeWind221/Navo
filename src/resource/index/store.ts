import { randomUUID } from "node:crypto";
import type { EmbeddingProvider } from "../../embedding/types.js";
import type { StorageService } from "../../storage/database.js";
import type { ResourceChunkRecord, ResourceIndexBuildRecord } from "../../storage/indexing.js";
import type { ResourceContentRecord } from "../../storage/content.js";
import type { TextChunk } from "./chunker.js";
import { CHUNKER_VERSION } from "./chunker.js";
import { decodeVector, VECTOR_ENCODING_VERSION } from "./vector.js";

export class ResourceIndexStore {
  constructor(private readonly storage: StorageService) {}

  builds(status?: ResourceIndexBuildRecord["status"]): readonly ResourceIndexBuildRecord[] {
    return this.storage.atomic(tx => tx.listIndexBuilds(status));
  }

  prepare(content: ResourceContentRecord, chunks: readonly TextChunk[], provider: EmbeddingProvider): ResourceIndexBuildRecord | undefined {
    return this.storage.atomic(tx => {
      const existing = tx.listIndexBuilds().find(build => build.project_id === content.project_id && build.resource_id === content.resource_id
        && (build.status === "building" || build.status === "active") && compatible(build, content, provider));
      if (existing?.status === "active") return undefined;
      if (existing !== undefined) return existing;
      for (const build of tx.listIndexBuilds("building")) {
        if (build.project_id === content.project_id && build.resource_id === content.resource_id) tx.supersedeIndexBuild(build.build_id);
      }
      const build = buildRecord(content, chunks.length, provider);
      tx.createIndexBuild(build, chunks.map(chunk => chunkRecord(build.build_id, chunk)));
      tx.bumpCatalogVersion(content.project_id);
      return build;
    });
  }

  recoverable(provider: EmbeddingProvider): readonly ResourceIndexBuildRecord[] {
    return this.storage.atomic(tx => tx.listIndexBuilds("building").filter(build => {
      const content = tx.getResourceContent(build.project_id, build.resource_id);
      if (content !== undefined && compatible(build, content, provider)) return true;
      if (tx.supersedeIndexBuild(build.build_id)) tx.bumpCatalogVersion(build.project_id);
      return false;
    }));
  }

  chunks(buildId: string): readonly ResourceChunkRecord[] {
    return this.storage.atomic(tx => tx.listBuildChunks(buildId));
  }

  pending(buildId: string, limit: number): readonly ResourceChunkRecord[] {
    return this.storage.atomic(tx => tx.listPendingChunks(buildId, limit));
  }

  attempt(buildId: string): void {
    this.storage.atomic(tx => tx.incrementIndexAttempt(buildId));
  }

  write(buildId: string, values: readonly { readonly chunkId: string; readonly embedding: Uint8Array }[]): boolean {
    return this.storage.atomic(tx => tx.writeChunkEmbeddings(buildId, values));
  }

  publish(buildId: string): boolean {
    return this.storage.atomic(tx => {
      const changed = tx.publishIndexBuild(buildId);
      if (changed) {
        const build = tx.getIndexBuild(buildId);
        if (build !== undefined) tx.bumpCatalogVersion(build.project_id);
      }
      return changed;
    });
  }

  fail(buildId: string, code: string, message: string): boolean {
    return this.storage.atomic(tx => {
      const changed = tx.failIndexBuild(buildId, code, message);
      if (changed) {
        const build = tx.getIndexBuild(buildId);
        if (build !== undefined) tx.bumpCatalogVersion(build.project_id);
      }
      return changed;
    });
  }

  supersede(buildId: string): boolean {
    return this.storage.atomic(tx => {
      const changed = tx.supersedeIndexBuild(buildId);
      if (changed) {
        const build = tx.getIndexBuild(buildId);
        if (build !== undefined) tx.bumpCatalogVersion(build.project_id);
      }
      return changed;
    });
  }

  validateStored(build: ResourceIndexBuildRecord): void {
    for (const chunk of this.chunks(build.build_id)) if (chunk.embedding !== null) decodeVector(chunk.embedding, build.embedding_dimension);
  }
}

export function compatible(build: ResourceIndexBuildRecord, content: ResourceContentRecord, provider: EmbeddingProvider): boolean {
  return build.source_asset_generation === content.source_asset_generation && build.chunker_version === CHUNKER_VERSION
    && compatibleProvider(build, provider);
}

export function compatibleProvider(build: ResourceIndexBuildRecord, provider: EmbeddingProvider): boolean {
  return build.embedding_provider === provider.id && build.embedding_model === provider.model
    && build.embedding_revision === provider.revision && build.embedding_dimension === provider.dimension
    && build.document_template_version === provider.documentTemplateVersion
    && build.query_template_version === provider.queryTemplateVersion
    && build.vector_encoding_version === VECTOR_ENCODING_VERSION;
}

function buildRecord(content: ResourceContentRecord, count: number, provider: EmbeddingProvider): ResourceIndexBuildRecord {
  const now = new Date().toISOString();
  return { build_id: randomUUID(), project_id: content.project_id, resource_id: content.resource_id,
    source_asset_generation: content.source_asset_generation, status: "building", chunker_version: CHUNKER_VERSION,
    embedding_provider: provider.id, embedding_model: provider.model, embedding_revision: provider.revision,
    embedding_dimension: provider.dimension, document_template_version: provider.documentTemplateVersion,
    query_template_version: provider.queryTemplateVersion, vector_encoding_version: VECTOR_ENCODING_VERSION,
    expected_chunk_count: count, attempt_count: 0, error_code: null, error_message: null, created_at: now, updated_at: now };
}

function chunkRecord(buildId: string, chunk: TextChunk): ResourceChunkRecord {
  return { chunk_id: `${buildId}:${String(chunk.ordinal).padStart(8, "0")}`, build_id: buildId, ordinal: chunk.ordinal,
    text: chunk.text, embedding_text: chunk.embeddingText, start_offset_utf16: chunk.startOffsetUtf16,
    end_offset_utf16: chunk.endOffsetUtf16, heading_path_json: JSON.stringify(chunk.headingPath), structure: chunk.structure,
    page_map_json: JSON.stringify(chunk.pages), embedding: null };
}
