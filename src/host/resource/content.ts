import type { Context } from "cordis";

import { RpcError } from "../../../rpc/errors.js";
import type {
  ResourceContentCancelInputV1,
  ResourceContentCancelResultV1,
  ResourceContentRetryInputV1,
  ResourceContentRetryResultV1,
} from "../../../rpc/resource/content.js";
import type { RpcStreamHandler } from "../../../rpc/stream.js";
import { createProjectId, createResourceId } from "../../brand/ids.js";
import { toResourceFailure } from "./failure.js";

export function createResourceContentRetryHandler(
  ctx: Context,
): RpcStreamHandler<ResourceContentRetryInputV1, ResourceContentRetryResultV1> {
  return async function* (input, signal) {
    signal.throwIfAborted();
    try {
      const result = ctx.userResources.retryContent({
        projectId: createProjectId(input.projectId),
        resourceId: createResourceId(input.resourceId),
        expectedRevision: input.expectedRevision,
      });
      yield result;
    } catch (error: unknown) {
      if (error instanceof RpcError) throw error;
      throw toResourceFailure(error);
    }
  };
}

export function createResourceContentCancelHandler(
  ctx: Context,
): RpcStreamHandler<ResourceContentCancelInputV1, ResourceContentCancelResultV1> {
  return async function* (input, signal) {
    signal.throwIfAborted();
    try {
      const result = ctx.userResources.cancelContent({
        projectId: createProjectId(input.projectId),
        resourceId: createResourceId(input.resourceId),
        expectedRevision: input.expectedRevision,
      });
      yield result;
    } catch (error: unknown) {
      if (error instanceof RpcError) throw error;
      throw toResourceFailure(error);
    }
  };
}
