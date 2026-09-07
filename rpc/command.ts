import type { SessionNotification } from "./notification.js";
import type { RpcMethod, RpcOutputValidator } from "./protocol.js";
import { RpcError } from "./errors.js";
import { parseSessionNotification } from "./notification.js";
import { exactKeys, requireBoundedString, requireRecord } from "./validation.js";

export type CommandNotification = SessionNotification & { readonly commandId: string };

export interface SessionCommandInput {
  readonly sessionId: string;
  /** Unique invocation identity; never the command name or RPC transport id. */
  readonly commandId: string;
  readonly name: string;
  readonly args: string;
}

export const COMMAND_ARGS_MAX_CHARS = 32_768;

export const sessionCommandMethod: RpcMethod<SessionCommandInput, CommandNotification> = Object.freeze({
  name: "session.command.v1",
  parseInput: parseSessionCommandInput,
  parseOutput: parseCommandNotification,
  createOutputValidator: createCommandOutputValidator,
});

export function parseSessionCommandInput(value: unknown): SessionCommandInput {
  const input = requireRecord(value, "session command input");
  if (!exactKeys(input, ["sessionId", "commandId", "name", "args"])) {
    throw new RpcError("invalid-frame", "Malformed session command input");
  }
  const name = requireBoundedString(input.name, "command name", 64);
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new RpcError("invalid-frame", "Invalid command name");
  if (typeof input.args !== "string" || input.args.length > COMMAND_ARGS_MAX_CHARS) {
    throw new RpcError("invalid-frame", "Invalid command args");
  }
  return { sessionId: requireBoundedString(input.sessionId, "sessionId", 128),
    commandId: requireBoundedString(input.commandId, "commandId", 128), name, args: input.args };
}

export function parseCommandNotification(value: unknown): CommandNotification {
  const event = parseSessionNotification(value);
  if (event.commandId === undefined) throw new RpcError("invalid-frame", "Command notification requires commandId");
  return { ...event, commandId: event.commandId };
}

export function createCommandOutputValidator(input: SessionCommandInput): RpcOutputValidator<CommandNotification> {
  const { sessionId, commandId } = input;
  let id: string | undefined;
  let running = false;
  let terminal = false;
  let poisoned = false;
  return {
    parse(value: unknown): CommandNotification {
      if (poisoned) invalid("Validator is closed after rejection");
      try {
        const event = parseCommandNotification(value);
        if (terminal || event.sessionId !== sessionId || event.commandId !== commandId
          || (id !== undefined && event.id !== id)) invalid("Command identity or terminal order mismatch");
        id = event.id;
        if (event.status === "running") {
          if (running) invalid("Duplicate running notification");
          running = true;
        } else {
          if (event.status === "succeeded" && !running) invalid("Command success requires running");
          terminal = true;
        }
        return event;
      } catch (error) {
        poisoned = true;
        throw error;
      }
    },
    end(): void {
      if (poisoned || !terminal) {
        poisoned = true;
        invalid("Command stream ended without a valid business terminal");
      }
    },
  };
}

function invalid(message: string): never {
  throw new RpcError("invalid-output", message);
}
