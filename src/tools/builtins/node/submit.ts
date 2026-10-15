import type { Context } from "cordis";

import { createResourceId } from "../../../brand/ids.js";
import type { JsonObject, JsonValue } from "../../../llm/types.js";
import { NodeError } from "../../../node/errors.js";
import type { NodeCriterionCheck, NodeSnapshot } from "../../../node/model.js";
import { AgentBindingError, requireNodeBinding } from "../../../project/binding.js";
import { ToolExecutionError } from "../../errors.js";
import type { ToolDefinition } from "../../types.js";

export const SUBMIT_COMPLETION_TOOL_NAME = "submit_completion";

const schema: JsonObject = {
  type: "object",
  properties: {
    summary: {
      type: "string",
      description: "What this Node produced and how the result was checked.",
    },
    resource_ids: {
      type: "array",
      items: { type: "string" },
      description: "IDs of Resources visible to this Node that hold the deliverables. Use an empty array when there are none.",
    },
    criteria: {
      type: "array",
      description: "One entry for every acceptance criterion of this Node.",
      items: {
        type: "object",
        properties: {
          criterion_index: {
            type: "integer",
            description: "1-based position of the acceptance criterion in node-context.",
          },
          satisfied: { type: "boolean" },
          note: {
            type: "string",
            description: "Evidence for a satisfied criterion, or what is missing.",
          },
        },
        required: ["criterion_index", "satisfied", "note"],
        additionalProperties: false,
      },
    },
    remaining: {
      type: "array",
      items: { type: "string" },
      description: "Work that is still unfinished. Use an empty array when nothing remains.",
    },
  },
  required: ["summary", "resource_ids", "criteria", "remaining"],
  additionalProperties: false,
};

export function createSubmitCompletionTool(ctx: Context): ToolDefinition {
  return {
    name: SUBMIT_COMPLETION_TOOL_NAME,
    description: "Submit this Node's work for review when you believe the objective is complete. The Node then waits for confirmation and this Turn ends immediately; it does not complete the Node or unlock other Nodes.",
    parameters: schema,
    execute(arguments_, execution) {
      try {
        execution.signal.throwIfAborted();
        const binding = requireNodeBinding(ctx, execution.sessionId);
        const node = ctx.nodes.requireState(binding.nodeId, "working");
        const visible = new Set(ctx.resources.listVisible(binding.projectId, { kind: "node", nodeId: binding.nodeId })
          .map(resource => String(resource.id)));
        const resourceIds = texts(arguments_.resource_ids, "resource_ids").map(id => {
          if (!visible.has(id)) invalid(`Resource '${id}' is not visible to this Node.`);
          return createResourceId(id);
        });
        const submitted = ctx.nodes.signalCompletion(binding.nodeId, {
          summary: text(arguments_.summary, "summary"),
          resourceIds,
          criteria: checks(node, arguments_.criteria),
          remaining: texts(arguments_.remaining, "remaining"),
        });
        return {
          content: "Completion submitted for review. This Turn ends now; the reviewer will confirm completion, request rework, or skip this Node.",
          artifact: { node_id: String(submitted.node.id), revision: submitted.revision },
          endsTurn: true,
        };
      } catch (error: unknown) {
        if (error instanceof ToolExecutionError) throw error;
        if (error instanceof AgentBindingError) {
          throw new ToolExecutionError(error.message, "submit_completion is available only to a Node Agent.", { cause: error });
        }
        if (error instanceof NodeError) {
          throw new ToolExecutionError(error.message, `The completion could not be submitted: ${error.message}`, { cause: error });
        }
        throw new ToolExecutionError(
          error instanceof Error ? error.message : "Unknown submit_completion failure.",
          "The completion could not be submitted.",
          { cause: error },
        );
      }
    },
  };
}

function checks(node: NodeSnapshot, value: JsonValue | undefined): readonly NodeCriterionCheck[] {
  const criteria = node.node.objective.acceptanceCriteria;
  if (!Array.isArray(value)) invalid("criteria must be an array.");
  const byIndex = new Map<number, NodeCriterionCheck>();
  for (const entry of value) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) invalid("Each criteria entry must be an object.");
    const index = entry.criterion_index;
    if (typeof index !== "number" || !Number.isSafeInteger(index) || index < 1 || index > criteria.length) {
      invalid(`criterion_index must be between 1 and ${criteria.length}.`);
    }
    if (byIndex.has(index)) invalid(`criterion_index ${index} is listed more than once.`);
    if (typeof entry.satisfied !== "boolean") invalid("satisfied must be a boolean.");
    byIndex.set(index, { criterion: criteria[index - 1]!, satisfied: entry.satisfied, note: text(entry.note, "note") });
  }
  if (byIndex.size !== criteria.length) invalid(`criteria must cover all ${criteria.length} acceptance criteria.`);
  return criteria.map((_, index) => byIndex.get(index + 1)!);
}

function texts(value: JsonValue | undefined, field: string): string[] {
  if (!Array.isArray(value)) invalid(`${field} must be an array.`);
  return value.map(item => text(item, field));
}

function text(value: JsonValue | undefined, field: string): string {
  if (typeof value !== "string" || !value.trim()) invalid(`${field} must contain non-empty text.`);
  return value;
}

function invalid(message: string): never {
  throw new ToolExecutionError(message, message);
}

export const SubmitCompletionTool = Object.assign(
  function registerSubmitCompletionTool(ctx: Context): () => void {
    const dispose = ctx.effect(
      () => ctx.tools.register(createSubmitCompletionTool(ctx)),
      "node.submit-completion-tool",
    );
    return () => { void dispose(); };
  },
  { inject: ["tools", "projects", "nodes", "resources"] },
);
