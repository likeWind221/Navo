import {
  agentTurnV2Method,
  parseAgentTurnInput,
} from "../../../../rpc/index.js";
import type { AgentTurnInput, RpcMethod, RpcStreamOptions } from "../../../../rpc/index.js";
import type { AgentTurnV2Event } from "../../../../rpc/content.js";
import type {
  DesktopAgentEvent,
  DesktopAgentFailure,
} from "../../../shared/agent.js";
import { RpcError } from "../../../../rpc/errors.js";

export interface AgentTurnV2Host {
  stream<TInput, TOutput>(
    method: RpcMethod<TInput, TOutput>,
    input: TInput,
    options?: RpcStreamOptions,
  ): AsyncIterable<TOutput>;
}

export interface AgentTurnV2Target {
  readonly ownerId: number;
  isDestroyed(): boolean;
  send(update: DesktopAgentEvent): void;
}

interface ActiveTurn {
  readonly sessionId: string;
  readonly requestId: string;
  readonly target: AgentTurnV2Target;
  readonly controller: AbortController;
  timedOut: boolean;
  turnId: string | undefined;
  readonly timeout: NodeJS.Timeout;
}

export class AgentTurnV2Controller {
  private active: ActiveTurn | undefined;
  private disposed = false;

  constructor(
    private readonly host: AgentTurnV2Host,
    private readonly timeoutMs = 120_000,
  ) {}

  start(target: AgentTurnV2Target, candidate: unknown): DesktopAgentFailure | null {
    if (this.disposed) return failure("bridge-closed", "Agent bridge is closed");
    if (this.active !== undefined) return failure("turn-in-progress", "Another Agent turn is active");
    let input: AgentTurnInput;
    try {
      input = parseAgentTurnInput(candidate);
    } catch {
      return failure("invalid-input", "The Agent turn input is invalid");
    }
    const controller = new AbortController();
    const turn: ActiveTurn = {
      sessionId: input.sessionId,
      requestId: input.requestId,
      target,
      controller,
      timedOut: false,
      turnId: undefined,
      timeout: setTimeout(() => {
        turn.timedOut = true;
        controller.abort("Agent turn timed out");
      }, this.timeoutMs),
    };
    this.active = turn;
    void this.run(turn, input);
    return null;
  }

  cancel(ownerId: number, requestId: string): void {
    const turn = this.active;
    if (turn === undefined || turn.target.ownerId !== ownerId || turn.requestId !== requestId) return;
    turn.controller.abort("Renderer cancelled the Agent turn");
  }

  cancelOwner(ownerId: number): void {
    const turn = this.active;
    if (turn?.target.ownerId === ownerId) turn.controller.abort("Renderer was destroyed");
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.active?.controller.abort("Agent bridge was disposed");
  }

  private async run(turn: ActiveTurn, input: AgentTurnInput): Promise<void> {
    let terminalPublished = false;
    try {
      for await (const event of this.host.stream(agentTurnV2Method, input, {
        signal: turn.controller.signal,
      })) {
        if (event.type === "turn-started") turn.turnId = event.turnId;
        this.publish(turn, { type: "turn-event", event });
        if (isTurnTerminal(event)) terminalPublished = true;
      }
    } catch (error: unknown) {
      if (terminalPublished) {
        return;
      }
      if (turn.timedOut) {
        this.publish(turn, {
          type: "turn-error",
          requestId: turn.requestId,
          failure: failure("turn-timeout", "Agent turn timed out"),
        });
      } else if (error instanceof RpcError && error.code === "cancelled" && turn.turnId !== undefined) {
        this.publish(turn, {
          type: "turn-event",
          event: turnScope(turn),
        });
      } else {
        this.publish(turn, {
          type: "turn-error",
          requestId: turn.requestId,
          failure: toDesktopFailure(error),
        });
      }
    } finally {
      clearTimeout(turn.timeout);
      if (this.active === turn) this.active = undefined;
    }
  }

  private publish(turn: ActiveTurn, update: DesktopAgentEvent): void {
    if (this.active !== turn || turn.target.isDestroyed()) return;
    turn.target.send(update);
  }
}

function turnScope(turn: ActiveTurn): AgentTurnV2Event {
  if (turn.turnId === undefined) throw new Error("Turn has no identity");
  return {
    type: "turn-cancelled",
    sessionId: turn.sessionId,
    requestId: turn.requestId,
    turnId: turn.turnId,
  };
}

function isTurnTerminal(event: AgentTurnV2Event): boolean {
  return event.type === "turn-completed"
    || event.type === "turn-cancelled"
    || event.type === "turn-failed"
    || event.type === "turn-truncated";
}

function toDesktopFailure(error: unknown): DesktopAgentFailure {
  if (error instanceof RpcError) return { code: error.code, message: safeRpcMessage(error) };
  return failure("host-unavailable", "Agent host is unavailable");
}

function safeRpcMessage(error: RpcError): string {
  if (error.code === "remote-error") return "Agent host reported a failure";
  if (error.code === "connection-closed") return "Agent host connection closed";
  return "Agent request failed";
}

function failure(code: string, message: string): DesktopAgentFailure {
  return { code, message };
}
