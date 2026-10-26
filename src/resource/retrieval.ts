import { Service, type Context } from "cordis";
import type { ResourceId } from "../brand/ids.js";
import type { ProjectResource } from "./model.js";
import type { GraphSnapshot } from "./graph/read.js";
import { ResourceIndexError } from "./index/errors.js";
import { CHUNKER_VERSION } from "./index/chunker.js";
import { chunkMetadata } from "./index/metadata.js";
import { insideFolder, normalizeLibraryPath } from "./library.js";
import { graphSearch } from "./retrieval/graph.js";
import { fuseRanks } from "./retrieval/fusion.js";
import type { RankedChunk, RetrievalChunk, RetrievalRequest, RetrievalResult } from "./retrieval/types.js";

export class ResourceRetrieval extends Service {
  static inject = ["storage", "resources", "indexSearch", "resourceGraph"];

  constructor(ctx: Context) { super(ctx, "retrieval"); }

  async search(request: RetrievalRequest): Promise<readonly RetrievalResult[]> {
    return this.searchScoped(request, () => this.ctx.resources.listVisible(request.projectId, request.viewer),
      resources => this.ctx.resourceGraph.read(request.projectId, request.viewer, resources.map(resource => resource.id)));
  }

  async searchUser(request: Omit<RetrievalRequest, "viewer">,
    userScope: () => readonly ProjectResource[]): Promise<readonly RetrievalResult[]> {
    return this.searchScoped({ ...request, userScope }, userScope, resources => this.ctx.resourceGraph.readUser(
      request.projectId, userScope, resources.map(resource => resource.id)));
  }

  private async searchScoped(request: RetrievalRequest | UserRetrievalRequest,
    scope: () => readonly ProjectResource[], readGraph: (resources: readonly ProjectResource[]) => GraphSnapshot): Promise<readonly RetrievalResult[]> {
    const query = request.query.trim();
    const topK = request.topK ?? 10;
    const vectorTopK = request.vectorTopK ?? 30;
    const maxHops = request.maxHops ?? 2;
    const mode = request.mode ?? "hybrid";
    if (!query || query.length > 4096 || !Number.isSafeInteger(topK) || topK < 1 || topK > 100
      || !Number.isSafeInteger(vectorTopK) || vectorTopK < 1 || vectorTopK > 100
      || !Number.isSafeInteger(maxHops) || maxHops < 0 || maxHops > 2 || !["hybrid", "vector"].includes(mode)) {
      throw new ResourceIndexError("invalid-query", "Retrieval requires a query of 1–4096 characters, topK and vectorTopK 1–100 and maxHops 0–2.");
    }
    if (request.folder !== undefined && request.folder !== "") normalizeLibraryPath(request.folder);
    request.signal?.throwIfAborted();
    let resources = this.scope(request, scope);
    if (resources.length === 0) return [];
    const vectors = "userScope" in request
      ? await this.ctx.indexSearch.searchUser({ ...request, query, resourceIds: resources.map(resource => resource.id), topK: vectorTopK })
      : await this.ctx.indexSearch.search({ ...request, query,
        resourceIds: resources.map(resource => resource.id), topK: vectorTopK });
    request.signal?.throwIfAborted();
    resources = this.scope(request, scope);
    const ids = resources.map(resource => resource.id);
    const vectorHits: RankedChunk[] = vectors.map(hit => ({ chunkId: hit.chunkId, route: "vector", paths: [] }));
    const graphHits = mode !== "hybrid" ? [] : graphSearch(readGraph(resources),
      query, new Set(vectorHits.map(hit => hit.chunkId)), maxHops, request.signal);
    request.signal?.throwIfAborted();
    resources = this.scope(request, scope);
    const groups = new Map<ResourceId, { resource: ProjectResource; fusionScore: number; chunks: RetrievalChunk[] }>();
    const allowed = new Map(resources.map(resource => [resource.id, resource]));
    const fused = fuseRanks([vectorHits, graphHits]);
    this.ctx.storage.atomic(tx => {
      let selected = 0;
      for (const hit of fused) {
        const row = tx.getSearchChunk(request.projectId, hit.chunkId, CHUNKER_VERSION);
        const resource = row === undefined ? undefined : allowed.get(row.resource_id as ResourceId);
        if (row === undefined || resource?.assetGeneration !== row.source_asset_generation) continue;
        const group = groups.get(resource.id) ?? { resource, fusionScore: hit.score, chunks: [] };
        if (group.chunks.length >= 3) continue;
        group.chunks.push({ resourceId: resource.id, chunkId: row.chunk_id, ordinal: row.ordinal, rank: ++selected,
          text: row.text, startOffsetUtf16: row.start_offset_utf16, endOffsetUtf16: row.end_offset_utf16,
          ...chunkMetadata(row),
          assetGeneration: resource.assetGeneration, fusionScore: hit.score, matches: hit.matches, paths: hit.paths });
        groups.set(resource.id, group);
        if (selected === topK) break;
      }
    });
    return [...groups.values()].map(({ resource, fusionScore, chunks }) => ({ resourceId: resource.id, name: resource.name,
      libraryPath: resource.libraryPath, assetGeneration: resource.assetGeneration, fusionScore, chunks }));
  }

  private scope(request: RetrievalRequest | UserRetrievalRequest, scope: () => readonly ProjectResource[]): readonly ProjectResource[] {
    const ids = request.resourceIds === undefined ? undefined : new Set(request.resourceIds);
    return scope().filter(resource => (ids === undefined || ids.has(resource.id))
      && (!request.folder || insideFolder(resource.libraryPath, request.folder)));
  }
}

type UserRetrievalRequest = Omit<RetrievalRequest, "viewer"> & {
  readonly userScope: () => readonly ProjectResource[];
};

declare module "cordis" { interface Context { retrieval: ResourceRetrieval } }
