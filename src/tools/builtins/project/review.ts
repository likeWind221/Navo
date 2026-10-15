import type { Context } from "cordis";

import type { JsonObject, JsonValue } from "../../../llm/types.js";
import { NodeError } from "../../../node/errors.js";
import type { ReviewDecision } from "../../../node/model.js";
import { AgentBindingError, requireMainBinding } from "../../../project/binding.js";
import { ProjectError } from "../../../project/errors.js";
import { ToolExecutionError } from "../../errors.js";
import type { ToolDefinition } from "../../types.js";

export const SUBMIT_REVIEW_TOOL_NAME = "submit_review";

const DECISIONS: readonly ReviewDecision[] = ["complete", "rework", "skip", "escalate"];

const schema: JsonObject = {
  type: "object",
  properties: {
    decision: {
      type: "string",
      enum: [...DECISIONS],
      description: "complete: the Node met every acceptance criterion and downstream work may start. rework: send the Node back with feedback; the Node becomes startable again. skip: the Node's work is not needed. escalate: leave the Node unchanged and let the Human decide.",
    },
    reason: {
      type: "string",
      description: "Why you decided this, naming the evidence you actually checked (Resources opened, work log entries read).",
    },
    feedback: {
      type: "string",
      description: "Required with rework: concrete instructions for what the Node must fix or add. The Node's objective and acceptance criteria are not changed by it.",
    },
  },
  required: ["decision", "reason"],
  additionalProperties: false,
};

export function createSubmitReviewTool(ctx: Context): ToolDefinition {
  return {
    name: SUBMIT_REVIEW_TOOL_NAME,
    description: "Record your single decision for the Node under review. Call it exactly once per review, after you checked the evidence. The decision applies to the Node revision you were shown and is rejected if that Node changed.",
    parameters: schema,
    execute(arguments_, execution) {
      try {
        execution.signal.throwIfAborted();
        const binding = requireMainBinding(ctx, execution.sessionId);
        const decision = DECISIONS.find(value => value === arguments_.decision);
        if (decision === undefined) {
          throw new ToolExecutionError("Invalid review decision.", `decision must be one of ${DECISIONS.join(", ")}.`);
        }
        const reason = typeof arguments_.reason === "string" ? arguments_.reason : "";
        const feedback = typeof arguments_.feedback === "string" ? arguments_.feedback : undefined;
        const node = ctx.reviews.submit(binding.projectId, {
          decision,
          reason,
          ...(feedback === undefined ? {} : { feedback }),
        });
        const artifact: JsonValue = {
          node_id: String(node.node.id),
          decision,
          status: node.status,
          revision: node.revision,
        };
        return {
          content: `Review recorded: ${decision}. Node is now ${node.status} (revision ${node.revision}). This review has its decision; you may now adjust downstream planning and then summarize for the user.`,
          artifact,
        };
      } catch (error: unknown) {
        if (error instanceof ToolExecutionError) throw error;
        if (error instanceof AgentBindingError) {
          throw new ToolExecutionError(error.message, `${SUBMIT_REVIEW_TOOL_NAME} is available only to the Main Agent of the current Project.`, { cause: error });
        }
        if (error instanceof NodeError || error instanceof ProjectError) {
          throw new ToolExecutionError(error.message, `The review decision was not recorded: ${error.message}`, { cause: error });
        }
        throw new ToolExecutionError(
          error instanceof Error ? error.message : "Unknown submit_review failure.",
          "The review decision could not be recorded.",
          { cause: error },
        );
      }
    },
  };
}

export const SubmitReviewTool = Object.assign(
  function registerSubmitReviewTool(ctx: Context): () => void {
    const dispose = ctx.effect(
      () => ctx.tools.register(createSubmitReviewTool(ctx)),
      "project.submit-review-tool",
    );
    return () => { void dispose(); };
  },
  { inject: ["tools", "projects", "nodes", "reviews"] },
);
