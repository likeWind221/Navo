import { RpcError } from "../errors.js";
import type { RpcMethod, RpcOutputValidator } from "../protocol.js";
import { parseResourceSearchInput, parseResourceSearchResult } from "./search/validation.js";

export const resourceSearchMethod: RpcMethod<ResourceSearchInputV1, ResourceSearchResultV1> = Object.freeze({
  name: "resource.user-search.v1",
  parseInput: parseResourceSearchInput,
  parseOutput: parseResourceSearchResult,
  createOutputValidator: () => singleOutput(parseResourceSearchResult),
});

export interface ResourceSearchInputV1 {
  readonly projectId: string;
  readonly query: string;
  readonly folder: string | null;
  readonly limit: number;
  readonly offset: number;
  readonly searchToken?: string;
}

export type ResourceSearchStatusV1 = "ready" | "no-results" | "content-unavailable" | "retrieval-unavailable" | "failed";

export interface ResourceSearchAvailabilityV1 {
  readonly searchable: number;
  readonly pending: number;
  readonly failed: number;
  readonly unindexed: number;
}

export interface ResourceSearchResultV1 {
  readonly projectId: string;
  readonly query: string;
  readonly folder: string | null;
  readonly status: ResourceSearchStatusV1;
  readonly errorCode: "content-unavailable" | "embedding-unconfigured" | "index-unavailable" | "search-failed" | null;
  readonly results: readonly ResourceSearchItemV1[];
  readonly nextOffset: number | null;
  readonly searchToken: string | null;
  readonly availability: ResourceSearchAvailabilityV1;
}

export interface ResourceSearchItemV1 {
  readonly resourceId: string;
  readonly name: string;
  readonly libraryPath: string;
  readonly assetGeneration: number;
  readonly fusionScore: number;
  readonly chunks: readonly ResourceSearchChunkV1[];
}

export interface ResourceSearchChunkV1 {
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

function singleOutput<T>(parse: (value: unknown) => T): RpcOutputValidator<T> {
  let received = false;
  return {
    parse(value) {
      if (received) throw new RpcError("invalid-output", "Resource search method returns exactly one item");
      received = true;
      return parse(value);
    },
    end() {
      if (!received) throw new RpcError("invalid-output", "Resource search method ended without a result");
    },
  };
}
