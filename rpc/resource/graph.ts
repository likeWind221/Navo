import { RpcError } from "../errors.js";
import type { RpcMethod, RpcOutputValidator } from "../protocol.js";
import { exactKeys, requireBoundedString, requireRecord } from "../validation.js";

export const resourceGraphStatusMethod: RpcMethod<ResourceGraphStatusInputV1, ResourceGraphStatusResultV1> = Object.freeze({
  name: "resource.graph-status.v1",
  parseInput: parseResourceGraphStatusInput,
  parseOutput: parseResourceGraphStatusResult,
  createOutputValidator: createResourceGraphStatusOutputValidator,
});

export interface ResourceGraphStatusInputV1 {
  readonly projectId: string;
  readonly resourceIds: readonly string[];
}

export type ResourceGraphStatusV1 = "unavailable" | "absent" | "building" | "active" | "failed" | "stale";

export interface ResourceGraphStatusItemV1 {
  readonly resourceId: string;
  readonly status: ResourceGraphStatusV1;
  readonly assetGeneration: number | null;
  readonly errorCode: string | null;
  readonly readable: boolean;
}

export interface ResourceGraphStatusResultV1 {
  readonly projectId: string;
  readonly configured: boolean;
  readonly resources: readonly ResourceGraphStatusItemV1[];
}

function parseResourceGraphStatusInput(value: unknown): ResourceGraphStatusInputV1 {
  const input = requireRecord(value, "resource graph status input");
  if (!exactKeys(input, ["projectId", "resourceIds"])) throw new RpcError("invalid-frame", "Malformed resource graph status input");
  if (!Array.isArray(input.resourceIds) || input.resourceIds.length < 1 || input.resourceIds.length > 100) {
    throw new RpcError("invalid-frame", "resourceIds must contain from 1 through 100 bounded resource IDs");
  }
  const resourceIds = input.resourceIds.map(resourceId => boundedResourceId(resourceId, "invalid-frame"));
  if (new Set(resourceIds).size !== resourceIds.length) throw new RpcError("invalid-frame", "resourceIds must not contain duplicates");
  return { projectId: requireBoundedString(input.projectId, "projectId", 128), resourceIds };
}

function parseResourceGraphStatusResult(value: unknown): ResourceGraphStatusResultV1 {
  const result = requireRecord(value, "resource graph status result");
  if (!exactKeys(result, ["projectId", "configured", "resources"])) throw new RpcError("invalid-output", "Malformed resource graph status result");
  if (typeof result.configured !== "boolean" || !Array.isArray(result.resources)
    || result.resources.length < 1 || result.resources.length > 100) throw new RpcError("invalid-output", "Malformed resource graph status result");
  return {
    projectId: requireBoundedString(result.projectId, "projectId", 128),
    configured: result.configured,
    resources: result.resources.map(parseResourceGraphStatusItem),
  };
}

function parseResourceGraphStatusItem(value: unknown): ResourceGraphStatusItemV1 {
  const item = requireRecord(value, "resource graph status item");
  if (!exactKeys(item, ["resourceId", "status", "assetGeneration", "errorCode", "readable"])) {
    throw new RpcError("invalid-output", "Malformed resource graph status item");
  }
  if (item.status !== "unavailable" && item.status !== "absent" && item.status !== "building"
    && item.status !== "active" && item.status !== "failed" && item.status !== "stale") {
    throw new RpcError("invalid-output", "Unknown resource graph status");
  }
  const status = item.status;
  const assetGeneration = item.assetGeneration;
  if (status === "unavailable") {
    if (assetGeneration !== null || item.errorCode !== null || item.readable !== false) {
      throw new RpcError("invalid-output", "Unavailable Graph resources must not expose current facts");
    }
  } else if (typeof assetGeneration !== "number" || !Number.isSafeInteger(assetGeneration) || assetGeneration < 1) {
    throw new RpcError("invalid-output", "Invalid resource graph asset generation");
  }
  if (item.errorCode !== null && (typeof item.errorCode !== "string" || item.errorCode.length === 0 || item.errorCode.length > 256)) {
    throw new RpcError("invalid-output", "Invalid resource graph error code");
  }
  if (typeof item.readable !== "boolean") throw new RpcError("invalid-output", "Invalid resource graph readable flag");
  if (status === "active" && (item.readable !== true || item.errorCode !== null)) {
    throw new RpcError("invalid-output", "Active Graph resources must be readable without an error");
  }
  if (status !== "active" && item.readable !== false) {
    throw new RpcError("invalid-output", "Non-active Graph resources must not be readable");
  }
  if (status !== "failed" && item.errorCode !== null) {
    throw new RpcError("invalid-output", "Only failed Graph resources may expose an error code");
  }
  return {
    resourceId: boundedResourceId(item.resourceId, "invalid-output"),
    status,
    assetGeneration: assetGeneration as number | null,
    errorCode: item.errorCode,
    readable: item.readable,
  };
}

function boundedResourceId(value: unknown, code: "invalid-frame" | "invalid-output"): string {
  const resourceId = requireBoundedString(value, "resourceId", 128);
  if (resourceId.trim().length === 0) throw new RpcError(code, "resourceId must not be blank");
  return resourceId;
}

function createResourceGraphStatusOutputValidator(input: ResourceGraphStatusInputV1): RpcOutputValidator<ResourceGraphStatusResultV1> {
  let received = false;
  return {
    parse(value) {
      if (received) throw new RpcError("invalid-output", "Resource graph status returns exactly one item");
      received = true;
      const result = parseResourceGraphStatusResult(value);
      if (result.projectId !== input.projectId || result.resources.length !== input.resourceIds.length
        || result.resources.some((resource, index) => resource.resourceId !== input.resourceIds[index])) {
        throw new RpcError("invalid-output", "Resource graph status crossed its requested scope");
      }
      return result;
    },
    end() {
      if (!received) throw new RpcError("invalid-output", "Resource graph status ended without a result");
    },
  };
}
