import type { Context } from "cordis";

import type { JsonObject } from "../../../llm/types.js";
import type { NodeSnapshot } from "../../../node/model.js";
import { AgentBindingError, requireMainBinding } from "../../../project/binding.js";
import { ToolExecutionError } from "../../errors.js";
import type { ToolDefinition } from "../../types.js";
import {
  agentRoadmapArtifact,
  createAgentRoadmapView,
  emptyAgentRoadmapView,
  formatAgentRoadmapView,
} from "./output.js";

export const READ_ROADMAP_TOOL_NAME = "read_roadmap";

const readRoadmapSchema: JsonObject = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export function createReadRoadmapTool(ctx: Context): ToolDefinition {
  return {
    name: READ_ROADMAP_TOOL_NAME,
    description: "Read the current Project roadmap. Returns a concise dependency map and Node summaries. Node status is observation-only and cannot be changed by this tool.",
    parameters: readRoadmapSchema,
    execute(_arguments, execution) {
      try {
        execution.signal.throwIfAborted();
        const binding = requireMainBinding(ctx, execution.sessionId);
        const roadmap = ctx.roadmaps.get(binding.projectId);
        const view = roadmap === undefined
          ? emptyAgentRoadmapView()
          : createAgentRoadmapView(
              roadmap,
              roadmap.graph.topologicalOrder
                .map((nodeId) => ctx.nodes.get(nodeId))
                .filter((value): value is NodeSnapshot => value !== undefined),
            );
        return {
          content: formatAgentRoadmapView(view),
          artifact: agentRoadmapArtifact(view),
        };
      } catch (error: unknown) {
        if (error instanceof AgentBindingError) {
          throw new ToolExecutionError(
            error.message,
            "read_roadmap is available only to the Main Agent of the current Project.",
            { cause: error },
          );
        }
        if (error instanceof Error) {
          throw new ToolExecutionError(
            error.message,
            "The current Roadmap could not be read.",
            { cause: error },
          );
        }
        throw new ToolExecutionError(
          "Unknown read_roadmap failure.",
          "The current Roadmap could not be read.",
        );
      }
    },
  };
}

export const ReadRoadmapTool = Object.assign(
  function registerReadRoadmapTool(ctx: Context): () => void {
    const dispose = ctx.effect(() => ctx.tools.register(createReadRoadmapTool(ctx)), "roadmap.read-tool");
    return () => { void dispose(); };
  },
  { inject: ["tools", "projects", "nodes", "roadmaps"] },
);
