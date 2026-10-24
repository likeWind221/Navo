import { Service, type Context } from "cordis";
import type { EmbeddingProvider } from "../embedding/types.js";
import type { ProjectId, ResourceId } from "../brand/ids.js";
import type { ResourcePrincipal } from "./model.js";
import type { ActiveChunkRecord } from "../storage/indexing.js";
import { ResourceIndexError } from "./index/errors.js";
import { decodeVector, dot, encodeVector, VECTOR_ENCODING_VERSION } from "./index/vector.js";
import { chunkMetadata } from "./index/metadata.js";

export interface IndexSearchRequest {
  readonly projectId: ProjectId;
  readonly viewer: ResourcePrincipal;
  readonly query: string;
  readonly topK?: number;
  readonly resourceIds?: readonly ResourceId[];
  readonly signal?: AbortSignal;
}

export interface IndexSearchResult {
  readonly resourceId: ResourceId;
  readonly chunkId: string;
  readonly ordinal: number;
  readonly text: string;
  readonly startOffsetUtf16: number;
  readonly endOffsetUtf16: number;
  readonly headingPath: readonly string[];
  readonly pages: readonly number[];
  readonly score: number;
}

export interface IndexSearchConfig { readonly provider?: EmbeddingProvider; readonly scanBatchSize?: number }

export class IndexSearch extends Service {
  static inject = ["storage", "resources"];
  private readonly provider: EmbeddingProvider | undefined;
  private readonly scanBatchSize: number;

  constructor(ctx: Context, config: IndexSearchConfig = {}) {
    super(ctx, "indexSearch");
    this.provider = config.provider;
    this.scanBatchSize = config.scanBatchSize ?? 256;
    if (!Number.isSafeInteger(this.scanBatchSize) || this.scanBatchSize < 1 || this.scanBatchSize > 4096) {
      throw new TypeError("Index scanBatchSize must be from 1 through 4096.");
    }
  }

  async search(request: IndexSearchRequest): Promise<readonly IndexSearchResult[]> {
    const provider = this.provider;
    if (provider === undefined) throw new ResourceIndexError("embedding-unconfigured", "Embedding is not configured.");
    const query = request.query.trim();
    const topK = request.topK ?? 10;
    if (!query || !Number.isSafeInteger(topK) || topK < 1 || topK > 100) {
      throw new ResourceIndexError("invalid-query", "Semantic search requires a query and topK from 1 through 100.");
    }
    const visible = this.ctx.resources.listVisible(request.projectId, request.viewer);
    const requested = request.resourceIds === undefined ? undefined : new Set(request.resourceIds);
    const resources = visible.filter(resource => requested === undefined || requested.has(resource.id));
    if (resources.length === 0) return Object.freeze([]);
    request.signal?.throwIfAborted();
    const vectors = await provider.embedMany({ kind: "query", inputs: [query], ...(request.signal === undefined ? {} : { signal: request.signal }) });
    const queryVector = decodeVector(encodeVector(vectors[0]!, provider.dimension), provider.dimension);
    const resourceIds = resources.map(resource => resource.id);
    const candidates: Scored[] = [];
    for (let offset = 0; offset < resourceIds.length; offset += 200) {
      const scope = resourceIds.slice(offset, offset + 200);
      let after: string | null = null;
      while (true) {
        request.signal?.throwIfAborted();
        const rows = this.ctx.storage.atomic(tx => tx.listActiveChunks({
          projectId: request.projectId, resourceIds: scope, provider: provider.id, model: provider.model, revision: provider.revision,
          dimension: provider.dimension, documentTemplateVersion: provider.documentTemplateVersion,
          queryTemplateVersion: provider.queryTemplateVersion, encodingVersion: VECTOR_ENCODING_VERSION,
          afterChunkId: after, limit: this.scanBatchSize,
        }));
        for (const row of rows) insertTop(candidates, { row, score: dot(queryVector, decodeVector(row.embedding!, provider.dimension)) }, topK);
        if (rows.length < this.scanBatchSize) break;
        after = rows.at(-1)!.chunk_id;
      }
    }
    const results = candidates.flatMap(({ row, score }) => {
      const resource = this.ctx.resources.getVisible(request.projectId, row.resource_id as ResourceId, request.viewer);
      if (resource?.assetGeneration !== row.source_asset_generation) return [];
      return [{ resourceId: resource.id, chunkId: row.chunk_id, ordinal: row.ordinal, text: row.text,
        startOffsetUtf16: row.start_offset_utf16, endOffsetUtf16: row.end_offset_utf16,
        ...chunkMetadata(row), score }];
    });
    return Object.freeze(results.map(result => Object.freeze(result)));
  }
}

interface Scored { readonly row: ActiveChunkRecord; readonly score: number }

function insertTop(values: Scored[], value: Scored, limit: number): void {
  values.push(value);
  values.sort((left, right) => right.score - left.score || left.row.resource_id.localeCompare(right.row.resource_id)
    || left.row.ordinal - right.row.ordinal || left.row.chunk_id.localeCompare(right.row.chunk_id));
  if (values.length > limit) values.pop();
}

declare module "cordis" { interface Context { indexSearch: IndexSearch } }
