import type { Context } from "cordis";

import type { JsonObject } from "../../../llm/types.js";
import type { ToolDefinition } from "../../types.js";
import {
  requireResourceToolCaller,
  resourceArtifact,
  resourceToolFailure,
} from "./common.js";

export const REGISTER_RESOURCE_TOOL_NAME = "register_resource";

const schema: JsonObject = {
  type: "object",
  properties: {
    path: {
      type: "string",
      description: "Existing file path relative to the current Project Workspace. Navo internal .navo paths are not accepted.",
    },
    name: { type: "string" },
    description: { type: "string" },
    type: {
      type: "string",
      description: "Resource media or semantic type, for example text/markdown or application/json.",
    },
  },
  required: ["path", "name", "description", "type"],
  additionalProperties: false,
};

export function createRegisterResourceTool(ctx: Context): ToolDefinition {
  return {
    name: REGISTER_RESOURCE_TOOL_NAME,
    description: "Publish an existing Project Workspace file as a new private Resource owned by the current Main or Node Agent. Project identity and Resource owner come from the trusted Session binding.",
    parameters: schema,
    async execute(arguments_, execution) {
      try {
        execution.signal.throwIfAborted();
        const caller = requireResourceToolCaller(ctx, execution.sessionId);
        const path = arguments_.path;
        const name = arguments_.name;
        const description = arguments_.description;
        const type = arguments_.type;
        if (
          typeof path !== "string"
          || typeof name !== "string"
          || typeof description !== "string"
          || typeof type !== "string"
        ) {
          throw new TypeError("register_resource arguments were not parsed as strings.");
        }
        const resource = await ctx.resources.publish({
          projectId: caller.projectId,
          owner: caller.principal,
          sourceRef: path,
          name,
          description,
          type,
        }, execution.signal);
        return {
          content: [
            "Resource registered successfully.",
            `Resource ID: ${resource.id}`,
            `Name: ${resource.name}`,
            `Revision: ${resource.revision}`,
            "Access: private",
          ].join("\n"),
          artifact: resourceArtifact(resource),
        };
      } catch (error: unknown) {
        return resourceToolFailure(error);
      }
    },
  };
}
