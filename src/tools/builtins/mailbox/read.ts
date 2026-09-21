import type { Context } from "cordis";

import type { JsonObject } from "../../../llm/types.js";
import {
  AgentBindingError,
  requireMainBinding,
} from "../../../project/binding.js";
import { ToolExecutionError } from "../../errors.js";
import type { ToolDefinition } from "../../types.js";

export const READ_MAILBOX_TOOL_NAME = "read_mailbox";

const schema: JsonObject = {
  type: "object",
  properties: {},
  required: [],
  additionalProperties: false,
};

export function createReadMailboxTool(ctx: Context): ToolDefinition {
  return {
    name: READ_MAILBOX_TOOL_NAME,
    description: "Read Node-to-Main messages from the current Project Mailbox. Caller identity and Project scope come from the trusted Main Session binding. Reading does not consume messages or start any Agent.",
    parameters: schema,
    execute(_arguments, execution) {
      try {
        execution.signal.throwIfAborted();
        const binding = requireMainBinding(ctx, execution.sessionId);
        const messages = ctx.mailbox.getHistory(binding.projectId)
          .filter(message =>
            message.sender.kind === "node"
            && message.recipient.kind === "main");

        if (messages.length === 0) {
          return {
            content: "No Node-to-Main messages are currently recorded for this Project.",
            artifact: { messages: [] },
          };
        }

        return {
          content: [
            "Node-to-Main Project Mailbox:",
            ...messages.map(message =>
              `[${message.sequence}] Node ${message.sender.kind === "node"
                ? message.sender.nodeId
                : ""}: ${message.body}`),
          ].join("\n"),
          artifact: {
            messages: messages.map(message => ({
              id: String(message.id),
              sequence: message.sequence,
              node_id: message.sender.kind === "node"
                ? String(message.sender.nodeId)
                : "",
              body: message.body,
            })),
          },
        };
      } catch (error: unknown) {
        if (error instanceof AgentBindingError) {
          throw new ToolExecutionError(
            error.message,
            "read_mailbox is available only to the current Project Main Agent.",
            { cause: error },
          );
        }
        if (error instanceof Error) {
          throw new ToolExecutionError(
            error.message,
            "The current Project Mailbox could not be read.",
            { cause: error },
          );
        }
        throw new ToolExecutionError(
          "Unknown read_mailbox failure.",
          "The current Project Mailbox could not be read.",
        );
      }
    },
  };
}

export const ReadMailboxTool = Object.assign(
  function registerReadMailboxTool(ctx: Context): () => void {
    const dispose = ctx.effect(
      () => ctx.tools.register(createReadMailboxTool(ctx)),
      "mailbox.read-tool",
    );
    return () => { void dispose(); };
  },
  { inject: ["tools", "projects", "nodes", "mailbox"] },
);
