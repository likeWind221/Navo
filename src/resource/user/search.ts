import { randomUUID } from "node:crypto";
import { Service, type Context } from "cordis";
import type { ProjectId } from "../../brand/ids.js";
import { ResourceIndexError } from "../index/errors.js";
import { insideFolder, normalizeLibraryPath } from "../library.js";
import { ResourceError } from "../errors.js";
import type { RetrievalResult } from "../retrieval/types.js";

export interface UserSearchInput {
  readonly projectId: ProjectId;
  readonly query: string;
  readonly folder?: string | null;
  readonly limit?: number;
  readonly offset?: number;
  readonly searchToken?: string;
}

export interface UserSearchResult {
  readonly projectId: ProjectId;
  readonly query: string;
  readonly folder: string | null;
  readonly status: "ready" | "no-results" | "content-unavailable" | "retrieval-unavailable" | "failed";
  readonly errorCode: "content-unavailable" | "embedding-unconfigured" | "index-unavailable" | "search-failed" | null;
  readonly results: readonly UserSearchItem[];
  readonly nextOffset: number | null;
  readonly searchToken: string | null;
  readonly availability: UserSearchAvailability;
}

export interface UserSearchItem {
  readonly resourceId: string;
  readonly name: string;
  readonly libraryPath: string;
  readonly assetGeneration: number;
  readonly fusionScore: number;
  readonly chunks: readonly UserSearchChunk[];
}

export interface UserSearchChunk {
  readonly resourceId: string;
  readonly chunkId: string;
  readonly ordinal: number;
  readonly text: string;
  readonly startOffsetUtf16: number;
  readonly endOffsetUtf16: number;
  readonly headingPath: readonly string[];
  readonly pages: readonly number[];
  readonly fusionScore: number;
  readonly rank: number;
  readonly assetGeneration: number;
  readonly matches: readonly ("vector" | "entity" | "graph")[];
}

export interface UserSearchAvailability {
  readonly searchable: number;
  readonly pending: number;
  readonly failed: number;
  readonly unindexed: number;
}

interface SearchOperation {
  readonly projectId: ProjectId;
  readonly query: string;
  readonly folder: string | null;
  readonly identity: SearchIdentity;
  readonly results: readonly UserSearchItem[];
  readonly availability: UserSearchAvailability;
  readonly createdAt: number;
}

interface SearchIdentity {
  readonly catalogVersion: number;
  readonly indexConfiguration: string;
  readonly graphConfiguration: string;
}

const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
const MAX_OFFSET = 100;
const MAX_OPERATIONS = 16;
const OPERATION_TTL_MS = 5 * 60 * 1000;
const TOKEN_VERSION = 1;
const MAX_PUBLIC_HEADING_CHARS = 512;

export class UserResourceSearch extends Service {
  static inject = ["storage", "userResources", "retrieval", "resourceIndex", "resourceGraph"];
  private readonly operations = new Map<string, SearchOperation>();

  constructor(ctx: Context) { super(ctx, "userResourceSearch"); }

  async search(input: UserSearchInput, signal: AbortSignal): Promise<UserSearchResult> {
    signal.throwIfAborted();
    const query = input.query.trim();
    const folder = input.folder === undefined || input.folder === null || input.folder === ""
      ? null : normalizeLibraryPath(input.folder);
    const limit = input.limit ?? DEFAULT_LIMIT;
    const offset = input.offset ?? 0;
    if (!query || query.length > 4096 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_LIMIT
      || !Number.isSafeInteger(offset) || offset < 0 || offset > MAX_OFFSET) {
      throw new ResourceError("invalid-resource", "User search requires a query, a limit from 1 through 100 and an offset from 0 through 100.");
    }
    this.expire(Date.now());
    if (input.searchToken !== undefined) {
      const operation = this.requireOperation(input.searchToken, input.projectId, query, folder);
      const current = this.identity(input.projectId);
      if (!sameIdentity(operation.identity, current)) {
        throw new ResourceError("search-changed", "The search scope changed; start a new search.");
      }
      const currentResources = new Map(this.ctx.userResources.listForSearch(operation.projectId).map(resource => [String(resource.id), resource]));
      if (operation.results.some(result => currentResources.get(result.resourceId)?.assetGeneration !== result.assetGeneration)) {
        throw new ResourceError("search-changed", "The search scope changed; start a new search.");
      }
      return page(operation, offset, limit, input.searchToken);
    }
    if (offset !== 0) throw new ResourceError("invalid-resource", "A new search must start at offset 0.");

    const allScope = () => this.ctx.userResources.listForSearch(input.projectId);
    const searchScope = () => searchableResources(this.ctx, allScope(), folder);
    const initial = allScope();
    const searchable = searchScope();
    const initialIdentity = this.identity(input.projectId);
    let results: readonly RetrievalResult[] = [];
    let status: UserSearchResult["status"] | undefined;
    let failure: unknown;
    try {
      if (searchable.length > 0) {
        results = await this.ctx.retrieval.searchUser({ projectId: input.projectId, query, ...(folder === null ? {} : { folder }),
          topK: 100, vectorTopK: 100, mode: "hybrid", signal }, searchScope);
      }
    } catch (error) {
      failure = error;
      signal.throwIfAborted();
      if (error instanceof ResourceIndexError && error.code === "embedding-unconfigured") status = "retrieval-unavailable";
      else status = "failed";
    }
    signal.throwIfAborted();
    const currentIdentity = this.identity(input.projectId);
    if (!sameIdentity(initialIdentity, currentIdentity)) {
      throw new ResourceError("search-changed", "The search scope changed; start a new search.");
    }
    const availability = summarize(this.ctx, input.projectId, allScope(), folder);
    status ??= deriveStatus(results, availability);
    let errorCode: UserSearchResult["errorCode"] = null;
    if (status === "retrieval-unavailable") errorCode = "index-unavailable";
    if (status === "failed") errorCode = "search-failed";
    if (status === "content-unavailable") errorCode = "content-unavailable";
    if (failure instanceof ResourceIndexError && failure.code === "embedding-unconfigured") errorCode = "embedding-unconfigured";
    if (status === "retrieval-unavailable" && !this.ctx.resourceIndex.isConfigured()) {
      errorCode = "embedding-unconfigured";
    }
    if (status === "retrieval-unavailable" || status === "failed" || status === "content-unavailable") {
      return { projectId: input.projectId, query, folder, status, errorCode, results: [], nextOffset: null, searchToken: null, availability };
    }
    if (results.length === 0) {
      return { projectId: input.projectId, query, folder, status: "no-results", errorCode: null, results: [], nextOffset: null, searchToken: null, availability };
    }
    const projected = results.map(projectResult).sort(compareResults);
    const operationId = randomUUID();
    const token = encodeToken(operationId);
    this.operations.set(operationId, { projectId: input.projectId, query, folder, identity: currentIdentity,
      results: projected, availability, createdAt: Date.now() });
    this.trim();
    return page(this.operations.get(operationId)!, 0, limit, token);
  }

  private identity(projectId: ProjectId): SearchIdentity {
    return {
      catalogVersion: this.ctx.storage.atomic(tx => tx.getCatalogVersion(projectId)),
      indexConfiguration: this.ctx.resourceIndex.configurationKey(),
      graphConfiguration: this.ctx.resourceGraph.configurationKey(),
    };
  }

  private requireOperation(token: string, projectId: ProjectId, query: string, folder: string | null): SearchOperation {
    const parsed = decodeToken(token);
    if (parsed === undefined) {
      throw new ResourceError("search-expired", "The search page is no longer available; start a new search.");
    }
    const operation = this.operations.get(parsed.operationId);
    if (operation === undefined) throw new ResourceError("search-expired", "The search page is no longer available; start a new search.");
    if (operation.projectId !== projectId || operation.query !== query || operation.folder !== folder) {
      throw new ResourceError("search-expired", "The search page is no longer available; start a new search.");
    }
    return operation;
  }

  private expire(now: number): void {
    for (const [id, operation] of this.operations) if (now - operation.createdAt >= OPERATION_TTL_MS) this.operations.delete(id);
  }

  private trim(): void {
    while (this.operations.size > MAX_OPERATIONS) this.operations.delete(this.operations.keys().next().value!);
  }
}

function page(operation: SearchOperation, offset: number, limit: number, token: string): UserSearchResult {
  const results = operation.results.slice(offset, offset + limit);
  return { projectId: operation.projectId, query: operation.query, folder: operation.folder,
    status: results.length === 0 && operation.results.length === 0 ? "no-results" : "ready", errorCode: null, results,
    nextOffset: offset + results.length < operation.results.length ? offset + results.length : null,
    searchToken: operation.results.length === 0 ? null : token, availability: operation.availability };
}

function encodeToken(operationId: string): string {
  return JSON.stringify({ v: TOKEN_VERSION, operationId });
}

function decodeToken(value: string): { readonly operationId: string } | undefined {
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.v !== TOKEN_VERSION || typeof parsed.operationId !== "string") return undefined;
    return { operationId: parsed.operationId };
  } catch {
    return undefined;
  }
}

function sameIdentity(left: SearchIdentity, right: SearchIdentity): boolean {
  return left.catalogVersion === right.catalogVersion && left.indexConfiguration === right.indexConfiguration
    && left.graphConfiguration === right.graphConfiguration;
}

function deriveStatus(results: readonly RetrievalResult[], availability: UserSearchAvailability): UserSearchResult["status"] {
  if (results.length > 0) return "ready";
  if (availability.searchable > 0) return "no-results";
  if (availability.failed > 0) return "failed";
  if (availability.pending > 0) return "content-unavailable";
  if (availability.unindexed > 0) return "retrieval-unavailable";
  return "no-results";
}

function summarize(ctx: Context, projectId: ProjectId,
  resources: readonly import("../model.js").ProjectResource[], folder: string | null): UserSearchAvailability {
  const result = { searchable: 0, pending: 0, failed: 0, unindexed: 0 };
  for (const resource of resources) {
    if (folder !== null && !insideFolder(resource.libraryPath, folder)) continue;
    const content = ctx.content.status(projectId, resource.id);
    if (content?.status === "pending" || content?.status === "processing" || content?.status === "metadata_only") { result.pending++; continue; }
    if (content?.status === "failed") { result.failed++; continue; }
    if (content === undefined) { result.pending++; continue; }
    const index = ctx.resourceIndex.currentStatus(projectId, resource.id);
    if (index.status === "active") result.searchable++;
    else if (index.status === "failed") result.failed++;
    else result.unindexed++;
  }
  return result;
}

function searchableResources(ctx: Context, resources: readonly import("../model.js").ProjectResource[], folder: string | null) {
  return resources.filter(resource => (folder === null || insideFolder(resource.libraryPath, folder))
    && ctx.content.status(resource.projectId, resource.id)?.status === "ready"
    && ctx.resourceIndex.currentStatus(resource.projectId, resource.id).status === "active");
}

function projectResult(result: RetrievalResult): UserSearchItem {
  return { resourceId: result.resourceId, name: result.name, libraryPath: result.libraryPath,
    assetGeneration: result.assetGeneration, fusionScore: result.fusionScore,
    chunks: result.chunks.map(chunk => ({ resourceId: chunk.resourceId, chunkId: chunk.chunkId, ordinal: chunk.ordinal,
      text: chunk.text, startOffsetUtf16: chunk.startOffsetUtf16, endOffsetUtf16: chunk.endOffsetUtf16,
      headingPath: chunk.headingPath.map(heading => heading.length > MAX_PUBLIC_HEADING_CHARS
        ? `${heading.slice(0, MAX_PUBLIC_HEADING_CHARS - 3)}...` : heading), pages: chunk.pages, fusionScore: chunk.fusionScore, rank: chunk.rank,
      assetGeneration: chunk.assetGeneration, matches: chunk.matches })) };
}

function compareResults(left: UserSearchItem, right: UserSearchItem): number {
  return right.fusionScore - left.fusionScore || compareText(left.libraryPath, right.libraryPath) || compareText(left.resourceId, right.resourceId);
}

function compareText(left: string, right: string): number { return left < right ? -1 : left > right ? 1 : 0; }

declare module "cordis" { interface Context { userResourceSearch: UserResourceSearch } }
