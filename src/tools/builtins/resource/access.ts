import type { Context } from "cordis";

import { createNodeId } from "../../../brand/ids.js";
import type { JsonObject, JsonValue } from "../../../llm/types.js";
import {
  AgentBindingError,
  requireMainBinding,
} from "../../../project/binding.js";
import type { ResourceAccess } from "../../../resource/model.js";
import { ToolExecutionError } from "../../errors.js";
import type { ToolDefinition } from "../../types.js";
import {
  invalidResourceTool,
  positiveRevision,
  resourceArtifact,
  resourceId,
  resourceToolFailure,
} from "./common.js";

export const SET_RESOURCE_ACCESS_TOOL_NAME = "set_resource_access";

const schema: JsonObject = {
  type: "object",
  properties: {
    resource_id: { type: "string" },
    expected_revision: { type: "integer" },
    access: {
      type: "object",
      properties: {
        kind: {
          type: "string",
          enum: ["private", "shared", "project"],
        },
        node_ids: {
          type: "array",
          items: { type: "string" },
        },
      },
      required: ["kind"],
      additionalProperties: false,
    },
  },
  required: ["resource_id", "expected_revision", "access"],
  additionalProperties: false,
};

export function createSetResourceAccessTool(ctx: Context): ToolDefinition {
  return {
    name: SET_RESOURCE_ACCESS_TOOL_NAME,
    description: "Change who may read a Project Resource. Only the current Project Main Agent may use this capability. Set private, share with specific work Nodes, or share with every work Node in the Project.",
    parameters: schema,
    execute(arguments_, execution) {
      try {
        execution.signal.throwIfAborted();
        const binding = requireMainBinding(ctx, execution.sessionId);
        const resource = ctx.resources.setAccess({
          projectId: binding.projectId,
          actor: { kind: "main" },
          resourceId: resourceId(arguments_.resource_id),
          expectedRevision: positiveRevision(arguments_.expected_revision),
          access: parseAccess(arguments_.access),
        });
        return {
          content: [
            "Resource access updated successfully.",
            `Resource ID: ${resource.id}`,
            `Revision: ${resource.revision}`,
            `Access: ${formatAccess(resource.access)}`,
          ].join("\n"),
          artifact: resourceArtifact(resource),
        };
      } catch (error: unknown) {
        if (error instanceof AgentBindingError) {
          throw new ToolExecutionError(
            error.message,
            "set_resource_access is available only to the current Project Main Agent.",
            { cause: error },
          );
        }
        return resourceToolFailure(error);
      }
    },
  };
}

export const SetResourceAccessTool = Object.assign(
  function registerSetResourceAccessTool(ctx: Context): () => void {
    const dispose = ctx.effect(
      () => ctx.tools.register(createSetResourceAccessTool(ctx)),
      "resource.set-access-tool",
    );
    return () => { void dispose(); };
  },
  { inject: ["tools", "projects", "nodes", "resources"] },
);

function parseAccess(value: JsonValue | undefined): ResourceAccess {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw invalidResourceTool("access must be an object.");
  }
  const access = value as Record<string, JsonValue>;
  const kind = access.kind;
  if (kind === "private" || kind === "project") {
    if (access.node_ids !== undefined) {
      throw invalidResourceTool(
        `access.node_ids is not allowed when access.kind is '${kind}'.`,
      );
    }
    return Object.freeze({ kind });
  }
  if (kind !== "shared") {
    throw invalidResourceTool(
      "access.kind must be private, shared, or project.",
    );
  }
  if (
    !Array.isArray(access.node_ids)
    || access.node_ids.length === 0
    || access.node_ids.some(nodeId =>
      typeof nodeId !== "string" || nodeId.trim().length === 0)
  ) {
    throw invalidResourceTool(
      "shared access requires a non-empty access.node_ids string array.",
    );
  }
  return Object.freeze({
    kind: "shared",
    nodeIds: Object.freeze(access.node_ids.map(nodeId =>
      createNodeId(nodeId as string))),
  });
}

function formatAccess(access: ResourceAccess): string {
  if (access.kind !== "shared") return access.kind;
  return `shared(${access.nodeIds.join(", ")})`;
}
