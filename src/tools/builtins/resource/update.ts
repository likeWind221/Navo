import type { Context } from "cordis";

import type { JsonObject } from "../../../llm/types.js";
import type { ResourceMetadataPatch } from "../../../resource/model.js";
import type { ToolDefinition } from "../../types.js";
import {
  invalidResourceTool,
  optionalText,
  positiveRevision,
  requireResourceToolCaller,
  resourceArtifact,
  resourceId,
  resourceToolFailure,
} from "./common.js";

export const UPDATE_RESOURCE_TOOL_NAME = "update_resource";

const schema: JsonObject = {
  type: "object",
  properties: {
    resource_id: { type: "string" },
    expected_revision: { type: "integer" },
    name: { type: "string" },
    description: { type: "string" },
    type: { type: "string" },
  },
  required: ["resource_id", "expected_revision"],
  additionalProperties: false,
};

export function createUpdateResourceTool(ctx: Context): ToolDefinition {
  return {
    name: UPDATE_RESOURCE_TOOL_NAME,
    description: "Update mutable metadata of a Resource owned by the current Main or Node Agent. Shared Resources owned by another Agent are read-only. Published file content is an immutable snapshot; register a new Resource for new content.",
    parameters: schema,
    execute(arguments_, execution) {
      try {
        execution.signal.throwIfAborted();
        const caller = requireResourceToolCaller(ctx, execution.sessionId);
        const changes: ResourceMetadataPatch = Object.freeze({
          ...(optionalText(arguments_.name, "name") === undefined
            ? {}
            : { name: arguments_.name as string }),
          ...(optionalText(arguments_.description, "description") === undefined
            ? {}
            : { description: arguments_.description as string }),
          ...(optionalText(arguments_.type, "type") === undefined
            ? {}
            : { type: arguments_.type as string }),
        });
        if (Object.keys(changes).length === 0) {
          throw invalidResourceTool("provide at least one of name, description, or type.");
        }
        const resource = ctx.resources.update({
          projectId: caller.projectId,
          actor: caller.principal,
          resourceId: resourceId(arguments_.resource_id),
          expectedRevision: positiveRevision(arguments_.expected_revision),
          changes,
        });
        return {
          content: [
            "Resource updated successfully.",
            `Resource ID: ${resource.id}`,
            `Revision: ${resource.revision}`,
          ].join("\n"),
          artifact: resourceArtifact(resource),
        };
      } catch (error: unknown) {
        return resourceToolFailure(error);
      }
    },
  };
}
