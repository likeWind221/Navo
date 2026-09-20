import type { Context } from "cordis";

import type { JsonObject } from "../../../llm/types.js";
import { MailboxError } from "../../../mailbox/errors.js";
import {
  AgentBindingError,
  requireNodeBinding,
} from "../../../project/binding.js";
import { ToolExecutionError } from "../../errors.js";
import type { ToolDefinition } from "../../types.js";

export const SEND_TO_MAIN_TOOL_NAME = "send_to_main";

const schema: JsonObject = {
  type: "object",
  properties: {
    message: {
      type: "string",
      description: "Plain-text result, blocker, coordination need, or planning request for the Main Agent.",
    },
  },
  required: ["message"],
  additionalProperties: false,
};

export function createSendToMainTool(ctx: Context): ToolDefinition {
  return {
    name: SEND_TO_MAIN_TOOL_NAME,
    description: "Send one plain-text message from the current Node to its Project Main Agent. The route and sender identity come from the trusted Session binding. This does not start Main, modify the Roadmap, or complete the Node.",
    parameters: schema,
    execute(arguments_, execution) {
      try {
        execution.signal.throwIfAborted();
        const binding = requireNodeBinding(ctx, execution.sessionId);
        const message = arguments_.message;
        if (typeof message !== "string") {
          throw new ToolExecutionError(
            "send_to_main message was not parsed as a string.",
            "message must be a non-empty string.",
          );
        }
        const posted = ctx.mailbox.postFromNode({
          projectId: binding.projectId,
          nodeId: binding.nodeId,
          body: message,
        });
        return {
          content: `Message sent to Main as Project mailbox sequence ${posted.sequence}.`,
          artifact: {
            message_id: String(posted.id),
            sequence: posted.sequence,
          },
        };
      } catch (error: unknown) {
        if (error instanceof ToolExecutionError) throw error;
        if (error instanceof AgentBindingError) {
          throw new ToolExecutionError(
            error.message,
            "send_to_main is available only to a Node Agent in the current Project.",
            { cause: error },
          );
        }
        if (error instanceof MailboxError) {
          throw new ToolExecutionError(
            error.message,
            error.code === "invalid-message"
              ? "message must be a non-empty string."
              : "The message could not be posted to the current Project Main Agent.",
            { cause: error },
          );
        }
        if (error instanceof Error) {
          throw new ToolExecutionError(
            error.message,
            "The message could not be sent to Main.",
            { cause: error },
          );
        }
        throw new ToolExecutionError(
          "Unknown send_to_main failure.",
          "The message could not be sent to Main.",
        );
      }
    },
  };
}

export const SendToMainTool = Object.assign(
  function registerSendToMainTool(ctx: Context): () => void {
    const dispose = ctx.effect(
      () => ctx.tools.register(createSendToMainTool(ctx)),
      "mailbox.send-to-main-tool",
    );
    return () => { void dispose(); };
  },
  { inject: ["tools", "projects", "nodes", "mailbox"] },
);
