import { Service } from "cordis";
import type { Context } from "cordis";

import type { CommandAnchor, CommandEvent } from "../../shared/content.js";
import { DISPLAY_SUMMARY_MAX_CHARS } from "../../shared/content.js";
import { CommandError, commandFailure } from "./errors.js";
import type {
  CommandDefinition,
  CommandEventHandler,
  CommandInput,
} from "./types.js";

declare module "cordis" {
  interface Context {
    commands: CommandService;
  }
}

export class CommandService extends Service {
  static inject = ["agentRuntime"];

  private readonly definitions = new Map<string, CommandDefinition>();

  constructor(ctx: Context) {
    super(ctx, "commands");
    this.register({
      name: "hello",
      mode: "sidecar",
      parseArgs: args => {
        if (args.trim() !== "") throw new CommandError("invalid-args", "hello does not accept arguments.");
      },
      execute: () => "hello",
    });
  }

  register(definition: CommandDefinition): () => void {
    assertName(definition.name);
    if (definition.mode !== "sidecar" && definition.mode !== "queued") {
      throw new CommandError("invalid-command", `Command '${definition.name}' has an invalid execution mode.`);
    }
    if (typeof definition.execute !== "function") {
      throw new CommandError("invalid-command", `Command '${definition.name}' must provide an execute function.`);
    }
    if (definition.parseArgs !== undefined && typeof definition.parseArgs !== "function") {
      throw new CommandError("invalid-command", `Command '${definition.name}' has an invalid argument parser.`);
    }
    if (this.definitions.has(definition.name)) {
      throw new CommandError("invalid-command", `Command '${definition.name}' is already registered.`);
    }
    this.definitions.set(definition.name, definition);
    let disposed = false;
    return () => {
      if (disposed) return;
      disposed = true;
      if (this.definitions.get(definition.name) === definition) this.definitions.delete(definition.name);
    };
  }

  async execute(
    input: CommandInput,
    onEvent: CommandEventHandler,
    signal: AbortSignal,
  ): Promise<void> {
    const anchor = this.ctx.agentRuntime.commandAnchor(input.sessionId);
    if (!/^[a-z][a-z0-9-]*$/.test(input.name)) {
      await this.fail(input, anchor, onEvent, new CommandError("invalid-command", "Invalid command name."));
      return;
    }
    if (signal.aborted) {
      await this.cancel(input, anchor, onEvent);
      return;
    }
    const definition = this.definitions.get(input.name);
    if (definition === undefined) {
      await this.fail(input, anchor, onEvent, new CommandError("unknown-command", `Unknown command '${input.name}'.`));
      return;
    }
    try {
      definition.parseArgs?.(input.args);
    } catch (error: unknown) {
      await this.fail(input, anchor, onEvent, error);
      return;
    }
    const run = () => this.run(definition, input, anchor, onEvent, signal);
    if (definition.mode === "queued") {
      try {
        await this.ctx.agentRuntime.enqueueCommand(input.sessionId, run, signal);
      } catch (error: unknown) {
        if (signal.aborted) await this.cancel(input, anchor, onEvent);
        else await onEvent({ ...scope(input, anchor), type: "command-failed", failure: commandFailure(error) });
      }
    } else {
      await run();
    }
  }

  private async run(
    definition: CommandDefinition,
    input: CommandInput,
    anchor: CommandAnchor,
    onEvent: CommandEventHandler,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) {
      await this.cancel(input, anchor, onEvent);
      return;
    }
    await onEvent({ ...scope(input, anchor), type: "command-started" });
    try {
      const result = await definition.execute({ ...input, anchor, signal });
      if (signal.aborted) {
        await this.cancel(input, anchor, onEvent);
        return;
      }
      await onEvent({ ...scope(input, anchor), type: "command-completed",
        summary: boundedSummary(result === undefined ? "Completed." : String(result)) });
    } catch (error: unknown) {
      if (signal.aborted) await this.cancel(input, anchor, onEvent);
      else await onEvent({ ...scope(input, anchor), type: "command-failed", failure: commandFailure(error) });
    }
  }

  private async fail(
    input: CommandInput,
    anchor: CommandAnchor,
    onEvent: CommandEventHandler,
    error: unknown,
  ): Promise<void> {
    await onEvent({ ...scope(input, anchor), type: "command-failed", failure: commandFailure(error) });
  }

  private async cancel(
    input: CommandInput,
    anchor: CommandAnchor,
    onEvent: CommandEventHandler,
  ): Promise<void> {
    await onEvent({ ...scope(input, anchor), type: "command-cancelled" });
  }
}

function assertName(name: string): void {
  if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new CommandError("invalid-command", "Invalid command name.");
}

function boundedSummary(value: string): string {
  return value.slice(0, DISPLAY_SUMMARY_MAX_CHARS) || "Completed.";
}

function scope(input: CommandInput, anchor: CommandAnchor): Omit<CommandEvent, "type" | "summary" | "failure"> {
  return { sessionId: input.sessionId, commandId: input.commandId, name: input.name, anchor };
}
