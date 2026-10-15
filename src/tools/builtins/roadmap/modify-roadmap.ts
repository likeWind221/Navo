import { randomUUID } from "node:crypto";
import type { Context } from "cordis";

import { createNodeId } from "../../../brand/ids.js";
import type { NodeId, ProjectId } from "../../../brand/ids.js";
import type { JsonObject, JsonValue } from "../../../llm/types.js";
import { NodeError } from "../../../node/errors.js";
import type { NodeDefinitionChange } from "../../../node/events.js";
import type { NodeRequirement } from "../../../node/model.js";
import type { CreateNodeInput } from "../../../node/store.js";
import { AgentBindingError, requireMainBinding } from "../../../project/binding.js";
import { RoadmapError } from "../../../roadmap/errors.js";
import type { RoadmapChange } from "../../../roadmap/events.js";
import type { RoadmapSnapshot } from "../../../roadmap/model.js";
import { ToolExecutionError } from "../../errors.js";
import type { ToolDefinition } from "../../types.js";
import {
  agentRoadmapArtifact,
  createAgentRoadmapView,
  formatAgentRoadmapView,
} from "./output.js";

export const MODIFY_ROADMAP_TOOL_NAME = "modify_roadmap";

const ACTIONS = ["add_node", "edit_node", "connect", "disconnect", "reorder", "remove_node"] as const;
type ModifyAction = typeof ACTIONS[number];

const modifyRoadmapSchema: JsonObject = {
  type: "object",
  properties: {
    base_version: {
      type: "integer",
      description: "Exact Roadmap version returned by read_roadmap or the previous successful Roadmap mutation.",
    },
    reason: {
      type: "string",
      description: "Why this Roadmap change is needed.",
    },
    action: {
      type: "string",
      enum: [...ACTIONS],
      description: "One mutation per call: add_node | edit_node | connect | disconnect | reorder | remove_node.",
    },
    key: {
      type: "string",
      description: "Proposal-local receipt key for add_node only. It is returned with the persistent Node ID and is not stored.",
    },
    title: {
      type: "string",
      description: "Node title. Required for add_node and edit_node.",
    },
    goal: {
      type: "string",
      description: "What the Node must achieve. Required for add_node and edit_node.",
    },
    done_when: {
      type: "array",
      items: { type: "string" },
      description: "Acceptance criteria, at least one. Required for add_node and edit_node.",
    },
    required: {
      type: "boolean",
      description: "Whether successors wait for this Node to be completed or skipped. Required for add_node and edit_node.",
    },
    depends_on: {
      type: "array",
      items: { type: "string" },
      description: "Persistent predecessor Node IDs. Required for add_node; use [] for none.",
    },
    index: {
      type: "integer",
      description: "Optional insertion position for add_node.",
    },
    node_id: {
      type: "string",
      description: "Persistent Node ID for edit_node or remove_node.",
    },
    node_version: {
      type: "integer",
      description: "Exact Node version returned by read_node. Required for edit_node.",
    },
    from_node_id: { type: "string" },
    to_node_id: { type: "string" },
    node_ids: {
      type: "array",
      items: { type: "string" },
      description: "Complete Roadmap Node ID order for reorder.",
    },
  },
  required: ["base_version", "reason", "action"],
  additionalProperties: false,
};

interface ParsedNodeDefinition {
  readonly title: string;
  readonly goal: string;
  readonly doneWhen: readonly string[];
  readonly required: boolean;
}

interface MutationResult {
  readonly snapshot: RoadmapSnapshot;
  readonly createdNodes?: JsonObject;
}

export function createModifyRoadmapTool(ctx: Context): ToolDefinition {
  return {
    name: MODIFY_ROADMAP_TOOL_NAME,
    description: "Modify the existing Roadmap for the current Project using an exact base version. Each call performs one planning action and returns the new authoritative Roadmap. Node completion and skip confirmation remain outside Main Agent authority.",
    parameters: modifyRoadmapSchema,
    execute(arguments_, execution) {
      try {
        execution.signal.throwIfAborted();
        const binding = requireMainBinding(ctx, execution.sessionId);
        const baseVersion = positiveInteger(arguments_.base_version, "base_version");
        const reason = nonEmptyString(arguments_.reason, "reason");
        const action = parseAction(arguments_.action);
        if (ctx.roadmaps.get(binding.projectId) === undefined) {
          throw new ToolExecutionError(
            `Project '${binding.projectId}' does not own a Roadmap.`,
            "No Roadmap exists for this Project. Use create_roadmap to create the initial plan first.",
          );
        }

        const result = applyAction(ctx, binding.projectId, baseVersion, reason, action, arguments_);
        const view = createAgentRoadmapView(result.snapshot, ctx.nodes.getByProject(binding.projectId));
        const artifact = agentRoadmapArtifact(view);
        const lines = ["Roadmap updated successfully."];
        if (result.createdNodes !== undefined) {
          lines.push("", "Created Node mapping:");
          for (const [key, nodeId] of Object.entries(result.createdNodes)) lines.push(`- ${key} -> ${String(nodeId)}`);
        }
        lines.push("", formatAgentRoadmapView(view));
        return {
          content: lines.join("\n"),
          artifact: result.createdNodes === undefined
            ? artifact
            : { ...artifact, created_nodes: result.createdNodes },
        };
      } catch (error: unknown) {
        if (error instanceof ToolExecutionError) throw error;
        if (error instanceof AgentBindingError) {
          throw new ToolExecutionError(
            error.message,
            "modify_roadmap is available only to the Main Agent of the current Project.",
            { cause: error },
          );
        }
        if (error instanceof RoadmapError) {
          throw new ToolExecutionError(error.message, roadmapFailureMessage(error), { cause: error });
        }
        if (error instanceof NodeError) {
          throw new ToolExecutionError(error.message, nodeFailureMessage(error), { cause: error });
        }
        if (error instanceof Error) {
          throw new ToolExecutionError(error.message, "The Roadmap could not be modified.", { cause: error });
        }
        throw new ToolExecutionError("Unknown modify_roadmap failure.", "The Roadmap could not be modified.");
      }
    },
  };
}

function applyAction(
  ctx: Context,
  projectId: ProjectId,
  baseVersion: number,
  reason: string,
  action: ModifyAction,
  arguments_: JsonObject,
): MutationResult {
  switch (action) {
    case "add_node": {
      assertOnly(arguments_, [
        "base_version", "reason", "action", "key", "title", "goal", "done_when", "required", "depends_on", "index",
      ]);
      const key = nonEmptyString(arguments_.key, "key");
      const definition = parseNodeDefinition(arguments_);
      const dependencies = nonEmptyStringArray(arguments_.depends_on, "depends_on", true);
      if (new Set(dependencies).size !== dependencies.length) {
        throw invalidMutation("depends_on contains duplicate Node IDs.");
      }
      const index = arguments_.index === undefined ? undefined : nonNegativeInteger(arguments_.index, "index");
      const nodeId = createNodeId(randomUUID());
      const changes: RoadmapChange[] = [
        { type: "insert", nodeId, ...(index === undefined ? {} : { index }) },
        ...dependencies.map((dependency) => ({
          type: "connect" as const,
          edge: { from: createNodeId(dependency), to: nodeId },
        })),
      ];
      const snapshot = ctx.roadmaps.change({
        projectId,
        baseRevision: baseVersion,
        reason,
        changes,
        newNodes: [{ nodeId, input: toCreateNodeInput(projectId, definition) }],
      });
      return { snapshot, createdNodes: { [key]: String(nodeId) } };
    }
    case "edit_node": {
      assertOnly(arguments_, [
        "base_version", "reason", "action", "node_id", "node_version", "title", "goal", "done_when", "required",
      ]);
      const nodeId = createNodeId(nonEmptyString(arguments_.node_id, "node_id"));
      const nodeVersion = positiveInteger(arguments_.node_version, "node_version");
      const definition = parseNodeDefinition(arguments_);
      const snapshot = ctx.roadmaps.change({
        projectId,
        baseRevision: baseVersion,
        reason,
        changes: [{ type: "update-node", nodeId }],
        nodeUpdates: [{
          nodeId,
          reviewedRevision: nodeVersion,
          requirement: requirement(definition.required),
          definition: toDefinitionChange(definition),
        }],
      });
      return { snapshot };
    }
    case "connect":
    case "disconnect": {
      assertOnly(arguments_, ["base_version", "reason", "action", "from_node_id", "to_node_id"]);
      const from = createNodeId(nonEmptyString(arguments_.from_node_id, "from_node_id"));
      const to = createNodeId(nonEmptyString(arguments_.to_node_id, "to_node_id"));
      const snapshot = ctx.roadmaps.change({
        projectId,
        baseRevision: baseVersion,
        reason,
        changes: [{ type: action, edge: { from, to } }],
      });
      return { snapshot };
    }
    case "reorder": {
      assertOnly(arguments_, ["base_version", "reason", "action", "node_ids"]);
      const ids = nonEmptyStringArray(arguments_.node_ids, "node_ids", false).map(createNodeId);
      const snapshot = ctx.roadmaps.change({
        projectId,
        baseRevision: baseVersion,
        reason,
        changes: [{ type: "reorder", nodeIds: ids }],
      });
      return { snapshot };
    }
    case "remove_node": {
      assertOnly(arguments_, ["base_version", "reason", "action", "node_id"]);
      const nodeId = createNodeId(nonEmptyString(arguments_.node_id, "node_id"));
      const snapshot = ctx.roadmaps.change({
        projectId,
        baseRevision: baseVersion,
        reason,
        changes: [{ type: "remove", nodeId }],
      });
      return { snapshot };
    }
  }
}

function parseNodeDefinition(arguments_: JsonObject): ParsedNodeDefinition {
  const title = nonEmptyString(arguments_.title, "title");
  const goal = nonEmptyString(arguments_.goal, "goal");
  const doneWhen = nonEmptyStringArray(arguments_.done_when, "done_when", false);
  if (typeof arguments_.required !== "boolean") throw invalidMutation("required must be a boolean.");
  return Object.freeze({ title, goal, doneWhen: Object.freeze(doneWhen), required: arguments_.required });
}

function toCreateNodeInput(projectId: ProjectId, definition: ParsedNodeDefinition): CreateNodeInput {
  return { projectId, requirement: requirement(definition.required), ...toDefinitionChange(definition) };
}

function toDefinitionChange(definition: ParsedNodeDefinition): NodeDefinitionChange {
  return {
    objective: {
      title: definition.title,
      description: definition.goal,
      acceptanceCriteria: definition.doneWhen,
    },
  };
}

function requirement(required: boolean): NodeRequirement {
  return required ? "required" : "optional";
}

function parseAction(value: JsonValue | undefined): ModifyAction {
  if (typeof value !== "string" || !ACTIONS.includes(value as ModifyAction)) {
    throw invalidMutation(`action must be one of: ${ACTIONS.join(", ")}.`);
  }
  return value as ModifyAction;
}

function nonEmptyString(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw invalidMutation(`${path} must be a non-empty string.`);
  return value.trim();
}

function nonEmptyStringArray(value: JsonValue | undefined, path: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value)) throw invalidMutation(`${path} must be an array of strings.`);
  if (!allowEmpty && value.length === 0) throw invalidMutation(`${path} must not be empty.`);
  return value.map((item, index) => nonEmptyString(item, `${path}[${index}]`));
}

function positiveInteger(value: JsonValue | undefined, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw invalidMutation(`${path} must be a positive safe integer.`);
  }
  return value;
}

function nonNegativeInteger(value: JsonValue | undefined, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidMutation(`${path} must be a non-negative safe integer.`);
  }
  return value;
}

function assertOnly(arguments_: JsonObject, allowed: readonly string[]): void {
  const permitted = new Set(allowed);
  const unexpected = Object.keys(arguments_).filter((key) => !permitted.has(key));
  if (unexpected.length > 0) throw invalidMutation(`${unexpected.join(", ")} is not valid for this action.`);
}

function invalidMutation(message: string): ToolExecutionError {
  return new ToolExecutionError(
    `Invalid modify_roadmap request: ${message}`,
    `The Roadmap modification is invalid: ${message}`,
  );
}

function roadmapFailureMessage(error: RoadmapError): string {
  switch (error.code) {
    case "stale-revision":
      return "The Roadmap changed since the version you read. Call read_roadmap again and retry against the current version.";
    case "not-found":
      return "No Roadmap exists for this Project. Use create_roadmap to create the initial plan first.";
    case "cycle":
      return "The Roadmap modification was rejected because it would create a dependency cycle.";
    case "duplicate-reference":
      return "The Roadmap modification was rejected because it creates a duplicate Node or dependency edge.";
    case "invalid-reference":
      return "The Roadmap modification references a Node or dependency that is not valid in the current Project Roadmap.";
    case "working-node":
      return "The Roadmap modification would invalidate a Node that is currently working. Finish or stop that work before replanning around it.";
    case "project-unavailable":
      return "The Roadmap can be modified only while the current Project is active.";
    default:
      return `The Roadmap modification was rejected: ${error.message}`;
  }
}

function nodeFailureMessage(error: NodeError): string {
  switch (error.code) {
    case "stale-revision":
      return "The Node changed since the version you read. Call read_node again and retry with its current version.";
    case "node-not-found":
      return "The requested Node does not exist in the current Project Roadmap.";
    case "invalid-state":
      return "The Node cannot be edited in its current state. Node definitions may change only while locked or idle.";
    case "project-unavailable":
      return "The Node can be edited only while the current Project is active.";
    default:
      return "The Node definition change was rejected by the Project domain.";
  }
}

export const ModifyRoadmapTool = Object.assign(
  function registerModifyRoadmapTool(ctx: Context): () => void {
    const dispose = ctx.effect(() => ctx.tools.register(createModifyRoadmapTool(ctx)), "roadmap.modify-roadmap-tool");
    return () => { void dispose(); };
  },
  { inject: ["tools", "projects", "nodes", "roadmaps"] },
);
