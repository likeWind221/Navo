import type { Context } from "cordis";

import type { ProjectId } from "../../../brand/ids.js";
import type { JsonObject, JsonValue } from "../../../llm/types.js";
import { NodeError } from "../../../node/errors.js";
import { AgentBindingError, requireMainBinding } from "../../../project/binding.js";
import { RoadmapError } from "../../../roadmap/errors.js";
import type { RoadmapSnapshot } from "../../../roadmap/model.js";
import { ToolExecutionError } from "../../errors.js";
import type { ToolDefinition } from "../../types.js";
import {
  agentRoadmapArtifact,
  createAgentRoadmapView,
  formatAgentRoadmapView,
} from "./output.js";

export const ADD_NODE_TOOL_NAME = "add_node";
export const EDIT_NODE_TOOL_NAME = "edit_node";
export const REMOVE_NODE_TOOL_NAME = "remove_node";
export const SET_DEPENDENCY_TOOL_NAME = "set_dependency";
export const REORDER_NODES_TOOL_NAME = "reorder_nodes";

export const ROADMAP_MUTATION_TOOL_NAMES: readonly string[] = Object.freeze([
  ADD_NODE_TOOL_NAME,
  EDIT_NODE_TOOL_NAME,
  REMOVE_NODE_TOOL_NAME,
  SET_DEPENDENCY_TOOL_NAME,
  REORDER_NODES_TOOL_NAME,
]);

export interface RoadmapMutationSpec {
  readonly name: string;
  readonly description: string;
  readonly properties: JsonObject;
  apply(ctx: Context, request: RoadmapMutationRequest, arguments_: JsonObject): RoadmapMutation;
}

export interface RoadmapMutationRequest {
  readonly projectId: ProjectId;
  readonly baseVersion: number;
  readonly reason: string;
}

export interface RoadmapMutation {
  readonly snapshot: RoadmapSnapshot;
  readonly createdNodes?: JsonObject;
}

export function createRoadmapMutationTool(ctx: Context, spec: RoadmapMutationSpec): ToolDefinition {
  const properties: JsonObject = {
    base_version: {
      type: "integer",
      description: "Exact Roadmap version returned by read_roadmap or the previous successful Roadmap change.",
    },
    reason: { type: "string", description: "Why this Roadmap change is needed." },
    ...spec.properties,
  };
  return {
    name: spec.name,
    description: spec.description,
    parameters: { type: "object", properties, required: Object.keys(properties), additionalProperties: false },
    execute(arguments_, execution) {
      try {
        execution.signal.throwIfAborted();
        const binding = requireMainBinding(ctx, execution.sessionId);
        const baseVersion = positiveInteger(arguments_.base_version, "base_version");
        const reason = nonEmptyString(arguments_.reason, "reason");
        if (ctx.roadmaps.get(binding.projectId) === undefined) {
          throw new ToolExecutionError(
            `Project '${binding.projectId}' does not own a Roadmap.`,
            "No Roadmap exists for this Project. Use create_roadmap to create the initial plan first.",
          );
        }
        const result = spec.apply(ctx, { projectId: binding.projectId, baseVersion, reason }, arguments_);
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
          artifact: result.createdNodes === undefined ? artifact : { ...artifact, created_nodes: result.createdNodes },
        };
      } catch (error: unknown) {
        if (error instanceof ToolExecutionError) throw error;
        if (error instanceof AgentBindingError) {
          throw new ToolExecutionError(
            error.message,
            `${spec.name} is available only to the Main Agent of the current Project.`,
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
        throw new ToolExecutionError(`Unknown ${spec.name} failure.`, "The Roadmap could not be modified.");
      }
    },
  };
}

export function nonEmptyString(value: JsonValue | undefined, path: string): string {
  if (typeof value !== "string" || value.trim().length === 0) throw invalidMutation(`${path} must be a non-empty string.`);
  return value.trim();
}

export function nonEmptyStringArray(value: JsonValue | undefined, path: string, allowEmpty: boolean): string[] {
  if (!Array.isArray(value)) throw invalidMutation(`${path} must be an array of strings.`);
  if (!allowEmpty && value.length === 0) throw invalidMutation(`${path} must not be empty.`);
  return value.map((item, index) => nonEmptyString(item, `${path}[${index}]`));
}

export function positiveInteger(value: JsonValue | undefined, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 1) {
    throw invalidMutation(`${path} must be a positive safe integer.`);
  }
  return value;
}

export function nonNegativeInteger(value: JsonValue | undefined, path: string): number {
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw invalidMutation(`${path} must be a non-negative safe integer.`);
  }
  return value;
}

export function invalidMutation(message: string): ToolExecutionError {
  return new ToolExecutionError(
    `Invalid Roadmap modification: ${message}`,
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
