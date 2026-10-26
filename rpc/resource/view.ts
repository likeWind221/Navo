import { RpcError } from "../errors.js";
import type { RpcMethod, RpcOutputValidator } from "../protocol.js";
import {
  parseResourceViewCopy,
  parseResourceViewCopyInput,
} from "./view/validation.js";

export const resourceViewCopyMethod: RpcMethod<ResourceViewCopyInputV1, ResourceViewCopyV1> = Object.freeze({
  name: "resource.view-copy.create.v1",
  parseInput: parseResourceViewCopyInput,
  parseOutput: parseResourceViewCopy,
  createOutputValidator: () => singleOutput(parseResourceViewCopy),
});

export interface ResourceViewCopyInputV1 {
  readonly projectId: string;
  readonly resourceId: string;
  readonly expectedRevision: number;
}

export interface ResourceViewCopyV1 {
  readonly projectId: string;
  readonly resourceId: string;
  readonly name: string;
  readonly type: string;
  readonly revision: number;
  readonly assetGeneration: number;
  readonly copyPath: string;
}

function singleOutput<T>(parse: (value: unknown) => T): RpcOutputValidator<T> {
  let received = false;
  return {
    parse(value) {
      if (received) throw new RpcError("invalid-output", "Resource view copy method returns exactly one item");
      received = true;
      return parse(value);
    },
    end() {
      if (!received) throw new RpcError("invalid-output", "Resource view copy method ended without a result");
    },
  };
}
