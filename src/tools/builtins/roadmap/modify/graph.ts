import { createNodeId } from "../../../../brand/ids.js";
import {
  REORDER_NODES_TOOL_NAME,
  SET_DEPENDENCY_TOOL_NAME,
  invalidMutation,
  nonEmptyString,
  nonEmptyStringArray,
} from "../modify.js";
import type { RoadmapMutationSpec } from "../modify.js";

export const setDependencyTool: RoadmapMutationSpec = {
  name: SET_DEPENDENCY_TOOL_NAME,
  description: "Add or remove one dependency edge: when connected is true, to_node_id waits for from_node_id; when false, that edge is removed.",
  properties: {
    from_node_id: { type: "string", description: "Persistent ID of the predecessor Node." },
    to_node_id: { type: "string", description: "Persistent ID of the successor Node." },
    connected: { type: "boolean", description: "true to add the edge, false to remove it." },
  },
  apply(ctx, request, arguments_) {
    const from = createNodeId(nonEmptyString(arguments_.from_node_id, "from_node_id"));
    const to = createNodeId(nonEmptyString(arguments_.to_node_id, "to_node_id"));
    if (typeof arguments_.connected !== "boolean") throw invalidMutation("connected must be a boolean.");
    const snapshot = ctx.roadmaps.change({
      projectId: request.projectId,
      baseRevision: request.baseVersion,
      reason: request.reason,
      changes: [{ type: arguments_.connected ? "connect" : "disconnect", edge: { from, to } }],
    });
    return { snapshot };
  },
};

export const reorderNodesTool: RoadmapMutationSpec = {
  name: REORDER_NODES_TOOL_NAME,
  description: "Set the presentation order of all Roadmap Nodes. Dependencies are unchanged.",
  properties: {
    node_ids: {
      type: "array",
      items: { type: "string" },
      description: "Every current Roadmap Node ID exactly once, in the new order.",
    },
  },
  apply(ctx, request, arguments_) {
    const nodeIds = nonEmptyStringArray(arguments_.node_ids, "node_ids", false).map(createNodeId);
    const snapshot = ctx.roadmaps.change({
      projectId: request.projectId,
      baseRevision: request.baseVersion,
      reason: request.reason,
      changes: [{ type: "reorder", nodeIds }],
    });
    return { snapshot };
  },
};
