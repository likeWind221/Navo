import { randomUUID } from "node:crypto";

import { createNodeId } from "../../../../brand/ids.js";
import type { JsonObject } from "../../../../llm/types.js";
import type { NodeDefinitionChange } from "../../../../node/events.js";
import type { NodeRequirement } from "../../../../node/model.js";
import type { RoadmapChange } from "../../../../roadmap/events.js";
import {
  ADD_NODE_TOOL_NAME,
  EDIT_NODE_TOOL_NAME,
  REMOVE_NODE_TOOL_NAME,
  invalidMutation,
  nonEmptyString,
  nonEmptyStringArray,
  nonNegativeInteger,
  positiveInteger,
} from "../modify.js";
import type { RoadmapMutationSpec } from "../modify.js";

const definitionProperties: JsonObject = {
  title: { type: "string", description: "Node title." },
  goal: { type: "string", description: "What the Node must achieve." },
  done_when: {
    type: "array",
    items: { type: "string" },
    description: "Acceptance criteria; at least one.",
  },
  required: {
    type: "boolean",
    description: "Whether successors wait for this Node to be completed or skipped.",
  },
};

export const addNodeTool: RoadmapMutationSpec = {
  name: ADD_NODE_TOOL_NAME,
  description: "Add one work Node to the existing Roadmap and connect it after the given predecessors. Returns the new authoritative Roadmap and the persistent ID of the added Node.",
  properties: {
    key: {
      type: "string",
      description: "Receipt key returned with the persistent Node ID; it is not stored.",
    },
    ...definitionProperties,
    depends_on: {
      type: "array",
      items: { type: "string" },
      description: "Persistent predecessor Node IDs; use [] for none.",
    },
    index: {
      type: ["integer", "null"],
      description: "0-based position in the Roadmap Node order, or null to append at the end.",
    },
  },
  apply(ctx, request, arguments_) {
    const key = nonEmptyString(arguments_.key, "key");
    const definition = parseDefinition(arguments_);
    const dependencies = nonEmptyStringArray(arguments_.depends_on, "depends_on", true);
    if (new Set(dependencies).size !== dependencies.length) {
      throw invalidMutation("depends_on contains duplicate Node IDs.");
    }
    const index = arguments_.index === null ? undefined : nonNegativeInteger(arguments_.index, "index");
    const nodeId = createNodeId(randomUUID());
    const changes: RoadmapChange[] = [
      { type: "insert", nodeId, ...(index === undefined ? {} : { index }) },
      ...dependencies.map(dependency => ({
        type: "connect" as const,
        edge: { from: createNodeId(dependency), to: nodeId },
      })),
    ];
    const snapshot = ctx.roadmaps.change({
      projectId: request.projectId,
      baseRevision: request.baseVersion,
      reason: request.reason,
      changes,
      newNodes: [{
        nodeId,
        input: { projectId: request.projectId, requirement: definition.requirement, ...definition.change },
      }],
    });
    return { snapshot, createdNodes: { [key]: String(nodeId) } };
  },
};

export const editNodeTool: RoadmapMutationSpec = {
  name: EDIT_NODE_TOOL_NAME,
  description: "Replace the title, goal, acceptance criteria and requirement of one locked or idle Node. Call read_node first and copy its exact version.",
  properties: {
    node_id: { type: "string", description: "Persistent Node ID." },
    node_version: { type: "integer", description: "Exact Node version returned by read_node." },
    ...definitionProperties,
  },
  apply(ctx, request, arguments_) {
    const nodeId = createNodeId(nonEmptyString(arguments_.node_id, "node_id"));
    const nodeVersion = positiveInteger(arguments_.node_version, "node_version");
    const definition = parseDefinition(arguments_);
    const snapshot = ctx.roadmaps.change({
      projectId: request.projectId,
      baseRevision: request.baseVersion,
      reason: request.reason,
      changes: [{ type: "update-node", nodeId }],
      nodeUpdates: [{
        nodeId,
        reviewedRevision: nodeVersion,
        requirement: definition.requirement,
        definition: definition.change,
      }],
    });
    return { snapshot };
  },
};

export const removeNodeTool: RoadmapMutationSpec = {
  name: REMOVE_NODE_TOOL_NAME,
  description: "Remove one Node and its dependency edges from the Roadmap. This changes the plan only; it does not mark the Node completed or skipped.",
  properties: {
    node_id: { type: "string", description: "Persistent Node ID." },
  },
  apply(ctx, request, arguments_) {
    const nodeId = createNodeId(nonEmptyString(arguments_.node_id, "node_id"));
    const snapshot = ctx.roadmaps.change({
      projectId: request.projectId,
      baseRevision: request.baseVersion,
      reason: request.reason,
      changes: [{ type: "remove", nodeId }],
    });
    return { snapshot };
  },
};

function parseDefinition(arguments_: JsonObject): { readonly requirement: NodeRequirement; readonly change: NodeDefinitionChange } {
  const title = nonEmptyString(arguments_.title, "title");
  const description = nonEmptyString(arguments_.goal, "goal");
  const acceptanceCriteria = Object.freeze(nonEmptyStringArray(arguments_.done_when, "done_when", false));
  if (typeof arguments_.required !== "boolean") throw invalidMutation("required must be a boolean.");
  return {
    requirement: arguments_.required ? "required" : "optional",
    change: { objective: { title, description, acceptanceCriteria } },
  };
}
