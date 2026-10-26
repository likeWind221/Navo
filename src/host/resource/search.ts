import type { ResourceSearchInputV1, ResourceSearchResultV1 } from "../../../rpc/resource/search.js";
import type { RpcStreamHandler } from "../../../rpc/stream.js";
import type { Context } from "cordis";
import { createProjectId } from "../../brand/ids.js";
import { toResourceFailure } from "./failure.js";

export function createResourceSearchHandler(ctx: Context): RpcStreamHandler<ResourceSearchInputV1, ResourceSearchResultV1> {
  return async function* (input, signal) {
    try {
      signal.throwIfAborted();
      const result = await ctx.userResources.search({
        projectId: createProjectId(input.projectId), query: input.query, folder: input.folder,
        limit: input.limit, offset: input.offset, ...(input.searchToken === undefined ? {} : { searchToken: input.searchToken }),
      }, signal);
      signal.throwIfAborted();
      yield result as ResourceSearchResultV1;
    } catch (error) {
      throw toResourceFailure(error);
    }
  };
}
