import type { Context } from "cordis";

import type { JsonObject } from "../../../llm/types.js";
import { AgentBindingError, requireMainBinding } from "../../../project/binding.js";
import { ProjectError } from "../../../project/errors.js";
import { PROJECT_GOAL_MAX_CHARS } from "../../../project/model.js";
import { ToolExecutionError } from "../../errors.js";
import type { ToolDefinition } from "../../types.js";

export const SET_PROJECT_GOAL_TOOL_NAME = "set_project_goal";

const schema: JsonObject = {
  type: "object",
  properties: {
    goal: {
      type: "string",
      description: `The Project goal exactly as the user agreed to it, at most ${PROJECT_GOAL_MAX_CHARS} characters.`,
    },
  },
  required: ["goal"],
  additionalProperties: false,
};

export function createSetProjectGoalTool(ctx: Context): ToolDefinition {
  return {
    name: SET_PROJECT_GOAL_TOOL_NAME,
    description: "Record the goal of the current Project after the user has explicitly agreed to it in this conversation. Record only what the user agreed to, without unconfirmed scope choices or answers to open questions, and quote the recorded goal verbatim to the user afterwards. The goal can be set only before the initial Roadmap exists; afterwards it is locked.",
    parameters: schema,
    execute(arguments_, execution) {
      try {
        execution.signal.throwIfAborted();
        const binding = requireMainBinding(ctx, execution.sessionId);
        if (ctx.roadmaps.get(binding.projectId) !== undefined) {
          throw new ToolExecutionError(
            `Project '${binding.projectId}' goal is locked by its Roadmap.`,
            "The Project goal is locked because the initial Roadmap already exists. Changing the goal after planning is not supported yet; tell the user instead of retrying.",
          );
        }
        const goal = typeof arguments_.goal === "string" ? arguments_.goal.trim() : "";
        const project = ctx.projects.setGoal(binding.projectId, goal);
        return {
          content: `Project goal recorded (Project revision ${project.revision}):\n${project.goal}`,
          artifact: { goal: project.goal, revision: project.revision },
        };
      } catch (error: unknown) {
        if (error instanceof ToolExecutionError) throw error;
        if (error instanceof AgentBindingError) {
          throw new ToolExecutionError(
            error.message,
            `${SET_PROJECT_GOAL_TOOL_NAME} is available only to the Main Agent of the current Project.`,
            { cause: error },
          );
        }
        if (error instanceof ProjectError) {
          throw new ToolExecutionError(error.message, goalFailureMessage(error), { cause: error });
        }
        if (error instanceof Error) {
          throw new ToolExecutionError(error.message, "The Project goal could not be recorded.", { cause: error });
        }
        throw new ToolExecutionError(
          `Unknown ${SET_PROJECT_GOAL_TOOL_NAME} failure.`,
          "The Project goal could not be recorded.",
        );
      }
    },
  };
}

function goalFailureMessage(error: ProjectError): string {
  switch (error.code) {
    case "invalid-goal":
      return `The Project goal must be non-blank text of at most ${PROJECT_GOAL_MAX_CHARS} characters.`;
    case "project-unavailable":
      return "The Project goal can be recorded only while the current Project is active.";
    default:
      return `The Project goal was rejected: ${error.message}`;
  }
}

export const SetProjectGoalTool = Object.assign(
  function registerSetProjectGoalTool(ctx: Context): () => void {
    const dispose = ctx.effect(
      () => ctx.tools.register(createSetProjectGoalTool(ctx)),
      "project.set-goal-tool",
    );
    return () => { void dispose(); };
  },
  { inject: ["tools", "projects", "nodes", "roadmaps"] },
);
