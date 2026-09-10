import { sessionCommandMethod, RpcError } from "../../../../rpc/index.js";
import type { CommandAnchor, CommandEvent } from "../../../../shared/content.js";
import type { SessionCommandInput } from "../../../../rpc/command.js";
import { parseSessionCommandInput } from "../../../../rpc/command.js";
import type { RpcMethod, RpcStreamOptions } from "../../../../rpc/index.js";
import type {
  DesktopAgentCommandErrorUpdate,
  DesktopAgentEvent,
  DesktopAgentFailure,
} from "../../../shared/agent.js";

export interface AgentCommandHost {
  stream<TInput, TOutput>(
    method: RpcMethod<TInput, TOutput>,
    input: TInput,
    options?: RpcStreamOptions,
  ): AsyncIterable<TOutput>;
}

export interface AgentCommandTarget {
  readonly ownerId: number;
  isDestroyed(): boolean;
  send(update: DesktopAgentEvent): void;
}

interface ActiveCommand {
  readonly input: SessionCommandInput;
  readonly target: AgentCommandTarget;
  readonly controller: AbortController;
  anchor: CommandAnchor | undefined;
}

export class AgentCommandController {
  private readonly active = new Map<string, ActiveCommand>();
  private disposed = false;

  constructor(private readonly host: AgentCommandHost) {}

  start(target: AgentCommandTarget, candidate: unknown): DesktopAgentFailure | null {
    if (this.disposed) return failure("bridge-closed", "Agent bridge is closed");
    let input: SessionCommandInput;
    try {
      input = parseSessionCommandInput(candidate);
    } catch {
      return failure("invalid-input", "The command input is invalid");
    }
    if (this.active.has(input.commandId)) return failure("command-in-progress", "This command is already active");
    const command: ActiveCommand = { input, target, controller: new AbortController(), anchor: undefined };
    this.active.set(input.commandId, command);
    void this.run(command);
    return null;
  }

  cancel(ownerId: number, commandId: string): void {
    const command = this.active.get(commandId);
    if (command?.target.ownerId === ownerId) command.controller.abort("Renderer cancelled the command");
  }

  cancelOwner(ownerId: number): void {
    for (const command of this.active.values()) {
      if (command.target.ownerId === ownerId) command.controller.abort("Renderer was destroyed");
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const command of this.active.values()) command.controller.abort("Agent bridge was disposed");
  }

  private async run(command: ActiveCommand): Promise<void> {
    let terminalPublished = false;
    try {
      for await (const event of this.host.stream(sessionCommandMethod, command.input, {
        signal: command.controller.signal,
      })) {
        command.anchor = event.anchor;
        this.publish(command, { type: "command-event", event });
        if (isCommandTerminal(event)) terminalPublished = true;
      }
    } catch (error: unknown) {
      if (terminalPublished) return;
      if (error instanceof RpcError && error.code === "cancelled") {
        this.publish(command, {
          type: "command-event",
          event: { ...commandScope(command.input, command.anchor), type: "command-cancelled" },
        });
      } else {
        const update: DesktopAgentCommandErrorUpdate = {
          type: "command-error",
          commandId: command.input.commandId,
          name: command.input.name,
          failure: toDesktopFailure(error),
        };
        this.publish(command, update);
      }
    } finally {
      if (this.active.get(command.input.commandId) === command) this.active.delete(command.input.commandId);
    }
  }

  private publish(command: ActiveCommand, update: DesktopAgentEvent): void {
    if (this.active.get(command.input.commandId) !== command || command.target.isDestroyed()) return;
    command.target.send(update);
  }
}

function commandScope(
  input: SessionCommandInput,
  anchor: CommandAnchor | undefined,
): Omit<CommandEvent, "type" | "summary" | "failure"> {
  return {
    sessionId: input.sessionId,
    commandId: input.commandId,
    name: input.name,
    anchor: anchor ?? { kind: "session" },
  };
}

function isCommandTerminal(event: CommandEvent): boolean {
  return event.type === "command-completed"
    || event.type === "command-failed"
    || event.type === "command-cancelled";
}

function toDesktopFailure(error: unknown): DesktopAgentFailure {
  if (error instanceof RpcError) return { code: error.code, message: error.code };
  return failure("host-unavailable", "Agent host is unavailable");
}

function failure(code: string, message: string): DesktopAgentFailure {
  return { code, message };
}
