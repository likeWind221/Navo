import type { Context } from "cordis";
import { userImportMethod } from "../../rpc/resource.js";
import { RpcError } from "../../rpc/errors.js";
import type { StreamRpcRouter } from "../../rpc/stream/router.js";
import { createProjectId } from "../brand/ids.js";
import { ResourceError } from "../resource/errors.js";

export function registerResourceMethods(router: StreamRpcRouter, ctx: Context): () => void {
  return router.register(userImportMethod, async function* (input, signal) {
    try {
      yield* ctx.userResources.import({ ...input, projectId: createProjectId(input.projectId) }, signal);
    } catch (error) {
      const code = error instanceof ResourceError ? error.code : "import-failed";
      throw new RpcError("remote-error", "User import failed.", {
        failure: { code, message: "User import failed.", details: {} },
      });
    }
  });
}
