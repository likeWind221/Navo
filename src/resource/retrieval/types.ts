import type { ResourceId } from "../../brand/ids.js";
import type { GraphSource } from "../graph/read.js";
import type { IndexSearchRequest, IndexSearchResult } from "../search.js";

export interface RetrievalRequest extends IndexSearchRequest {
  readonly folder?: string;
  readonly mode?: "hybrid" | "vector" | "keyword";
  readonly maxHops?: number;
}

export interface RetrievalResult {
  readonly resourceId: ResourceId;
  readonly name: string;
  readonly libraryPath: string;
  readonly assetGeneration: number;
  readonly score: number;
  readonly chunks: readonly RetrievalChunk[];
}

export interface RetrievalChunk extends IndexSearchResult {
  readonly assetGeneration: number;
  readonly matches: readonly RetrievalRoute[];
  readonly paths: readonly RelationPath[];
}

export interface RelationPath {
  readonly entities: readonly { readonly id: string; readonly name: string; readonly type: string }[];
  readonly relations: readonly {
    readonly id: string;
    readonly sourceId: string;
    readonly targetId: string;
    readonly type: string;
    readonly direction: "outgoing" | "incoming";
    readonly evidence: readonly GraphSource[];
  }[];
}

export type RetrievalRoute = "vector" | "keyword" | "entity" | "graph";

export interface RankedChunk {
  readonly chunkId: string;
  readonly route: RetrievalRoute;
  readonly paths: readonly RelationPath[];
}
