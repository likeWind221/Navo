import type { Context } from "cordis";

import type { JsonObject } from "../../../llm/types.js";
import type { ToolDefinition } from "../../types.js";
import {
  positiveRevision,
  requireResourceToolCaller,
  RESOURCE_ID_PARAMETER,
  resolveResourceRef,
  resourceToolFailure,
  withVisibleResourceRefs,
} from "./common.js";

export const DELETE_RESOURCE_TOOL_NAME = "delete_resource";

const schema: JsonObject = {
  type: "object",
  properties: {
    resource_id: RESOURCE_ID_PARAMETER,
    expected_revision: { type: "integer" },
  },
  required: ["resource_id", "expected_revision"],
  additionalProperties: false,
};

export function createDeleteResourceTool(ctx: Context): ToolDefinition {
  return {
    name: DELETE_RESOURCE_TOOL_NAME,
    description: "Delete the Resource fact owned by the current Main or Node Agent at the exact current revision. Physical content is cleaned only after active readers finish.",
    parameters: schema,
    parametersFor: sessionId => withVisibleResourceRefs(ctx, schema, sessionId),
    async execute(arguments_, execution) {
      try {
        execution.signal.throwIfAborted();
        const caller = requireResourceToolCaller(ctx, execution.sessionId);
        const id = resolveResourceRef(ctx, caller, arguments_.resource_id);
        await ctx.resources.delete({
          projectId: caller.projectId,
          actor: caller.principal,
          resourceId: id,
          expectedRevision: positiveRevision(arguments_.expected_revision),
        });
        return {
          content: `Resource ${id} deleted from the active Project Resource set. Unreferenced physical content is scheduled for safe cleanup.`,
          artifact: {
            resource_id: String(id),
            deleted: true,
          },
        };
      } catch (error: unknown) {
        return resourceToolFailure(error);
      }
    },
  };
}

export const DeleteResourceTool = Object.assign(
  function registerDeleteResourceTool(ctx: Context): () => void {
    const dispose = ctx.effect(
      () => ctx.tools.register(createDeleteResourceTool(ctx)),
      "resource.delete-tool",
    );
    return () => { void dispose(); };
  },
  { inject: ["tools", "projects", "nodes", "resources"] },
);
