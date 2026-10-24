import { Service, type Context } from "cordis";
import type { ResourceId } from "../brand/ids.js";
import type { ActiveChunkRecord } from "../storage/indexing.js";
import type { ProjectResource } from "./model.js";
import { ResourceIndexError } from "./index/errors.js";
import { CHUNKER_VERSION } from "./index/chunker.js";
import { chunkMetadata } from "./index/metadata.js";
import { insideFolder, normalizeLibraryPath } from "./library.js";
import { keywordSearch } from "./retrieval/lexical.js";
import { graphSearch } from "./retrieval/graph.js";
import { fuseRanks } from "./retrieval/fusion.js";
import type { RankedChunk, RetrievalChunk, RetrievalRequest, RetrievalResult } from "./retrieval/types.js";

export class ResourceRetrieval extends Service {
  static inject = ["storage", "resources", "indexSearch", "resourceGraph"];

  constructor(ctx: Context) { super(ctx, "retrieval"); }

  async search(request: RetrievalRequest): Promise<readonly RetrievalResult[]> {
    const query = request.query.trim();
    const topK = request.topK ?? 10;
    const maxHops = request.maxHops ?? 2;
    const mode = request.mode ?? "hybrid";
    if (!query || query.length > 4096 || !Number.isSafeInteger(topK) || topK < 1 || topK > 100
      || !Number.isSafeInteger(maxHops) || maxHops < 0 || maxHops > 3 || !["hybrid", "vector", "keyword"].includes(mode)) {
      throw new ResourceIndexError("invalid-query", "Retrieval requires a query of 1–4096 characters, topK 1–100 and maxHops 0–3.");
    }
    if (request.folder !== undefined && request.folder !== "") normalizeLibraryPath(request.folder);
    request.signal?.throwIfAborted();
    let resources = this.scope(request);
    if (resources.length === 0) return [];
    const vectors = mode === "keyword" ? [] : await this.ctx.indexSearch.search({ ...request, query,
      resourceIds: resources.map(resource => resource.id), topK: 100 });
    request.signal?.throwIfAborted();
    resources = this.scope(request);
    const ids = resources.map(resource => resource.id);
    const keywords = mode === "vector" ? [] : keywordSearch(this.chunks(request, ids), query, 100, request.signal);
    const vectorHits: RankedChunk[] = vectors.map(hit => ({ chunkId: hit.chunkId, route: "vector", paths: [] }));
    const graphHits = mode !== "hybrid" ? [] : graphSearch(this.ctx.resourceGraph.read(request.projectId, request.viewer, ids),
      query, new Set([...vectorHits.slice(0, 16), ...keywords.slice(0, 16)].map(hit => hit.chunkId)), maxHops, request.signal);
    request.signal?.throwIfAborted();
    const groups = new Map<ResourceId, { resource: ProjectResource; score: number; chunks: RetrievalChunk[] }>();
    const allowed = new Map(resources.map(resource => [resource.id, resource]));
    for (const hit of fuseRanks([vectorHits, keywords, graphHits])) {
      const row = this.ctx.storage.atomic(tx => tx.getSearchChunk(request.projectId, hit.chunkId, CHUNKER_VERSION));
      const resource = row === undefined ? undefined : allowed.get(row.resource_id as ResourceId);
      if (row === undefined || resource?.assetGeneration !== row.source_asset_generation) continue;
      const group = groups.get(resource.id) ?? { resource, score: hit.score, chunks: [] };
      if (group.chunks.length < 5) group.chunks.push({ resourceId: resource.id, chunkId: row.chunk_id, ordinal: row.ordinal,
        text: row.text, startOffsetUtf16: row.start_offset_utf16, endOffsetUtf16: row.end_offset_utf16,
        ...chunkMetadata(row),
        assetGeneration: resource.assetGeneration, score: hit.score, matches: hit.matches, paths: hit.paths });
      groups.set(resource.id, group);
    }
    return [...groups.values()].sort((a, b) => b.score - a.score || a.resource.id.localeCompare(b.resource.id))
      .slice(0, topK).map(({ resource, score, chunks }) => ({ resourceId: resource.id, name: resource.name,
        libraryPath: resource.libraryPath, assetGeneration: resource.assetGeneration, score, chunks }));
  }

  private scope(request: RetrievalRequest): readonly ProjectResource[] {
    const ids = request.resourceIds === undefined ? undefined : new Set(request.resourceIds);
    return this.ctx.resources.listVisible(request.projectId, request.viewer).filter(resource => (ids === undefined || ids.has(resource.id))
      && (!request.folder || insideFolder(resource.libraryPath, request.folder)));
  }

  private *chunks(request: RetrievalRequest, ids: readonly ResourceId[]): Iterable<ActiveChunkRecord> {
    for (let offset = 0; offset < ids.length; offset += 200) {
      let after: string | null = null;
      while (true) {
        request.signal?.throwIfAborted();
        const rows: readonly ActiveChunkRecord[] = this.ctx.storage.atomic(tx => tx.scanSearchChunks({ projectId: request.projectId,
          resourceIds: ids.slice(offset, offset + 200), chunkerVersion: CHUNKER_VERSION, afterChunkId: after, limit: 256 }));
        yield* rows;
        if (rows.length < 256) break;
        after = rows.at(-1)!.chunk_id;
      }
    }
  }
}

declare module "cordis" { interface Context { retrieval: ResourceRetrieval } }
