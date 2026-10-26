import type { Context } from "cordis";
import type { ResourceGraphStatusInputV1, ResourceGraphStatusResultV1 } from "../../../rpc/resource/graph.js";
import type { RpcStreamHandler } from "../../../rpc/stream.js";
import { createProjectId, createResourceId } from "../../brand/ids.js";
import { toResourceFailure } from "./failure.js";

export function createResourceGraphStatusHandler(
  ctx: Context,
): RpcStreamHandler<ResourceGraphStatusInputV1, ResourceGraphStatusResultV1> {
  return async function* (input, signal) {
    try {
      signal.throwIfAborted();
      const projectId = createProjectId(input.projectId);
      const visible = new Map(ctx.userResources.listForSearch(projectId).map(resource => [String(resource.id), resource]));
      const resources = input.resourceIds.map(resourceId => {
        const resource = visible.get(resourceId);
        if (resource === undefined) return {
          resourceId, status: "unavailable" as const, assetGeneration: null, errorCode: null, readable: false,
        };
        const graph = ctx.resourceGraph.describe(projectId, createResourceId(resourceId));
        return { resourceId, ...graph, assetGeneration: resource.assetGeneration };
      });
      signal.throwIfAborted();
      yield { projectId: input.projectId, configured: ctx.resourceGraph.isConfigured(), resources };
    } catch (error: unknown) {
      throw toResourceFailure(error);
    }
  };
}
