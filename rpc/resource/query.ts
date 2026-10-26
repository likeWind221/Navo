import { RpcError } from "../errors.js";
import type { RpcMethod, RpcOutputValidator } from "../protocol.js";
import {
  parseResourceQueryInput,
  parseResourceQueryResult,
} from "./query/validation.js";
import type { ResourceLibraryItemV1 } from "../resource.js";

export const resourceQueryMethod: RpcMethod<ResourceQueryInputV1, ResourceQueryResultV1> = Object.freeze({
  name: "resource.user-query.v1",
  parseInput: parseResourceQueryInput,
  parseOutput: parseResourceQueryResult,
  createOutputValidator: () => singleOutput(parseResourceQueryResult),
});

export interface ResourceQueryInputV1 {
  readonly projectId: string;
  readonly query?: string;
  readonly folder?: string | null;
  readonly limit?: number;
  readonly offset?: number;
  readonly expectedChangeToken?: string;
}

export interface ResourceIndexStatusV1 {
  readonly status: "waiting-config" | "absent" | "building" | "active" | "failed" | "stale";
  readonly errorCode: string | null;
}

export interface ResourceQueryItemV1 extends ResourceLibraryItemV1 {
  readonly index: ResourceIndexStatusV1;
}

export interface ResourceQueryResultV1 {
  readonly projectId: string;
  readonly query: string;
  readonly folder: string | null;
  readonly resources: readonly ResourceQueryItemV1[];
  readonly nextOffset: number | null;
  readonly changeToken: string;
}

function singleOutput<T>(parse: (value: unknown) => T): RpcOutputValidator<T> {
  let received = false;
  return {
    parse(value) {
      if (received) throw new RpcError("invalid-output", "Resource query method returns exactly one item");
      received = true;
      return parse(value);
    },
    end() {
      if (!received) throw new RpcError("invalid-output", "Resource query method ended without a result");
    },
  };
}
