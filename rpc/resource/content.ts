import { RpcError } from "../errors.js";
import type { RpcMethod, RpcOutputValidator } from "../protocol.js";
import { parseContentRetryInput, parseContentRetryResult } from "./content/validation.js";

export const resourceContentRetryMethod: RpcMethod<ResourceContentRetryInputV1, ResourceContentRetryResultV1> = Object.freeze({
  name: "resource.content.retry.v1",
  parseInput: parseContentRetryInput,
  parseOutput: parseContentRetryResult,
  createOutputValidator: () => singleOutput(parseContentRetryResult),
});

export interface ResourceContentRetryInputV1 {
  readonly projectId: string;
  readonly resourceId: string;
  readonly expectedRevision: number;
}

export interface ResourceContentRetryResultV1 {
  readonly projectId: string;
  readonly resourceId: string;
  readonly revision: number;
  readonly assetGeneration: number;
  readonly status: "accepted";
  readonly contentStatus: "pending";
}

function singleOutput<T>(parse: (value: unknown) => T): RpcOutputValidator<T> {
  let received = false;
  return {
    parse(value) {
      if (received) throw new RpcError("invalid-output", "Resource content retry method returns exactly one item");
      received = true;
      return parse(value);
    },
    end() {
      if (!received) throw new RpcError("invalid-output", "Resource content retry method ended without a result");
    },
  };
}
