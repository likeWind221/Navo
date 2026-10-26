import type { Context } from "cordis";
import type { ResourceQueryInputV1, ResourceQueryItemV1, ResourceQueryResultV1 } from "../../../rpc/resource/query.js";
import type { RpcStreamHandler } from "../../../rpc/stream.js";
import { createProjectId } from "../../brand/ids.js";
import { toResourceFailure } from "./failure.js";
import { describeLibraryItem } from "./view.js";

export function createResourceQueryHandler(
  ctx: Context,
): RpcStreamHandler<ResourceQueryInputV1, ResourceQueryResultV1> {
  return async function* (input, signal) {
    try {
      signal.throwIfAborted();
      const result = ctx.userResources.query({
        projectId: createProjectId(input.projectId),
        ...(input.query === undefined ? {} : { query: input.query }),
        ...(input.folder === undefined ? {} : { folder: input.folder }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
        ...(input.offset === undefined ? {} : { offset: input.offset }),
        ...(input.expectedChangeToken === undefined ? {} : { expectedChangeToken: input.expectedChangeToken }),
      }, signal);
      const resources: ResourceQueryItemV1[] = result.resources.map(item => ({
        ...describeLibraryItem(ctx, item.resource, item.content),
        index: describeIndex(item.index),
      }));
      signal.throwIfAborted();
      yield {
        projectId: result.projectId,
        query: result.query,
        folder: result.folder,
        resources,
        nextOffset: result.nextOffset,
        changeToken: result.changeToken,
      };
    } catch (error: unknown) {
      throw toResourceFailure(error);
    }
  };
}

function describeIndex(index: import("../../resource/index.js").CurrentResourceIndexStatus) {
  if (index.status === "waiting-config" || index.status === "absent" || index.status === "stale") {
    return { status: index.status, errorCode: null } as const;
  }
  return { status: index.status, errorCode: "errorCode" in index ? index.errorCode : null } as const;
}
