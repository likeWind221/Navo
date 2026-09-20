import type { Context } from "cordis";

import type { JsonObject } from "../../../llm/types.js";
import type { ToolDefinition } from "../../types.js";
import {
  positiveRevision,
  requireResourceToolCaller,
  resourceId,
  resourceToolFailure,
} from "./common.js";

export const DELETE_RESOURCE_TOOL_NAME = "delete_resource";

const schema: JsonObject = {
  type: "object",
  properties: {
    resource_id: { type: "string" },
    expected_revision: { type: "integer" },
  },
  required: ["resource_id", "expected_revision"],
  additionalProperties: false,
};

export function createDeleteResourceTool(ctx: Context): ToolDefinition {
  return {
    name: DELETE_RESOURCE_TOOL_NAME,
    description: "Delete the Resource fact owned by the current Main or Node Agent at the exact current revision. Physical Resource content is retained for audit and later cleanup.",
    parameters: schema,
    execute(arguments_, execution) {
      try {
        execution.signal.throwIfAborted();
        const caller = requireResourceToolCaller(ctx, execution.sessionId);
        const id = resourceId(arguments_.resource_id);
        ctx.resources.delete({
          projectId: caller.projectId,
          actor: caller.principal,
          resourceId: id,
          expectedRevision: positiveRevision(arguments_.expected_revision),
        });
        return {
          content: `Resource ${id} deleted from the active Project Resource set. Physical content was retained.`,
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
