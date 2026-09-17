import type { Context } from "cordis";

import { createNodeId } from "../../../brand/ids.js";
import type { JsonObject } from "../../../llm/types.js";
import { AgentBindingError, requireMainBinding } from "../../../project/binding.js";
import { ToolExecutionError } from "../../errors.js";
import type { ToolDefinition } from "../../types.js";
import {
  agentNodeArtifact,
  createAgentNodeView,
  formatAgentNodeView,
} from "./output.js";

export const READ_NODE_TOOL_NAME = "read_node";

const readNodeSchema: JsonObject = {
  type: "object",
  properties: {
    node_id: {
      type: "string",
      minLength: 1,
    },
  },
  required: ["node_id"],
  additionalProperties: false,
};

export function createReadNodeTool(ctx: Context): ToolDefinition {
  return {
    name: READ_NODE_TOOL_NAME,
    description: "Read one Node in the current Project. Returns its current definition, revision and read-only status without exposing private Session or confirmation state.",
    parameters: readNodeSchema,
    execute(arguments_, execution) {
      try {
        execution.signal.throwIfAborted();
        const binding = requireMainBinding(ctx, execution.sessionId);
        const nodeId = createNodeId(String(arguments_.node_id));
        const snapshot = ctx.nodes.get(nodeId);
        if (snapshot === undefined || snapshot.node.projectId !== binding.projectId) {
          throw new ToolExecutionError(
            `Node '${nodeId}' is not available in Project '${binding.projectId}'.`,
            "The requested Node does not exist in the current Project.",
          );
        }
        const view = createAgentNodeView(snapshot);
        return {
          content: formatAgentNodeView(view),
          artifact: agentNodeArtifact(view),
        };
      } catch (error: unknown) {
        if (error instanceof ToolExecutionError) throw error;
        if (error instanceof AgentBindingError) {
          throw new ToolExecutionError(
            error.message,
            "read_node is available only to the Main Agent of the current Project.",
            { cause: error },
          );
        }
        if (error instanceof Error) {
          throw new ToolExecutionError(
            error.message,
            "The requested Node could not be read.",
            { cause: error },
          );
        }
        throw new ToolExecutionError(
          "Unknown read_node failure.",
          "The requested Node could not be read.",
        );
      }
    },
  };
}

export const ReadNodeTool = Object.assign(
  function registerReadNodeTool(ctx: Context): () => void {
    const dispose = ctx.effect(() => ctx.tools.register(createReadNodeTool(ctx)), "roadmap.read-node-tool");
    return () => { void dispose(); };
  },
  { inject: ["tools", "projects", "nodes"] },
);
