import type { RpcFailure, RpcMethod } from "./protocol.js";
import {
  exactKeys,
  parseRpcFailure,
  requireBoundedString,
  requireRecord,
} from "./validation.js";
import { RpcError } from "./errors.js";

export type AgentTurnEvent =
  | AgentTurnStarted
  | AgentTextDelta
  | AgentTurnCompleted
  | AgentTurnCancelled
  | AgentTurnFailed
  | AgentTurnTruncated;

export interface AgentTurnInput {
  readonly sessionId: string;
  readonly requestId: string;
  readonly text: string;
}

export interface AgentTurnStarted {
  readonly type: "started";
  readonly turnId: string;
}

export interface AgentTextDelta {
  readonly type: "text-delta";
  readonly text: string;
}

export interface AgentTurnCompleted {
  readonly type: "completed";
}

export interface AgentTurnCancelled {
  readonly type: "cancelled";
}

export interface AgentTurnFailed {
  readonly type: "failed";
  readonly failure: RpcFailure;
}

export interface AgentTurnTruncated {
  readonly type: "truncated";
}

export const AGENT_TEXT_MAX_CHARS = 32_768;
export const AGENT_DELTA_MAX_CHARS = 16_384;

export const agentTurnMethod: RpcMethod<AgentTurnInput, AgentTurnEvent> = Object.freeze({
  name: "agent.turn",
  parseInput: parseAgentTurnInput,
  parseOutput: parseAgentTurnEvent,
  createOutputValidator: createAgentTurnOutputValidator,
});

export function parseAgentTurnInput(value: unknown): AgentTurnInput {
  const input = requireRecord(value, "agent.turn input");
  if (!exactKeys(input, ["sessionId", "requestId", "text"])) {
    return invalid("Malformed agent.turn input");
  }
  return {
    sessionId: requireBoundedString(input.sessionId, "sessionId", 128),
    requestId: requireBoundedString(input.requestId, "requestId", 128),
    text: requireBoundedString(input.text, "text", AGENT_TEXT_MAX_CHARS),
  };
}

export function parseAgentTurnEvent(value: unknown): AgentTurnEvent {
  const event = requireRecord(value, "agent.turn event");
  if (event.type === "started" && exactKeys(event, ["type", "turnId"])) {
    return { type: "started", turnId: requireBoundedString(event.turnId, "turnId", 128) };
  }
  if (event.type === "text-delta" && exactKeys(event, ["type", "text"])) {
    return { type: "text-delta", text: requireBoundedString(event.text, "delta text", AGENT_DELTA_MAX_CHARS) };
  }
  if (event.type === "failed" && exactKeys(event, ["type", "failure"])) {
    return { type: "failed", failure: parseRpcFailure(event.failure) };
  }
  if (event.type === "completed" && exactKeys(event, ["type"])) return { type: "completed" };
  if (event.type === "cancelled" && exactKeys(event, ["type"])) return { type: "cancelled" };
  if (event.type === "truncated" && exactKeys(event, ["type"])) return { type: "truncated" };
  return invalid("Unknown or malformed agent.turn event");
}

export function isAgentTurnTerminal(event: AgentTurnEvent): boolean {
  return event.type === "completed"
    || event.type === "cancelled"
    || event.type === "failed"
    || event.type === "truncated";
}

export function createAgentTurnOutputValidator(): {
  parse(value: unknown): AgentTurnEvent;
  end(): void;
} {
  let started = false;
  let terminal = false;
  return {
    parse(value: unknown): AgentTurnEvent {
      const event = parseAgentTurnEvent(value);
      if (!started) {
        if (event.type !== "started") return invalidOutput("agent.turn must start with a started event");
        started = true;
        return event;
      }
      if (terminal || event.type === "started") return invalidOutput("agent.turn event order is invalid");
      if (isAgentTurnTerminal(event)) terminal = true;
      return event;
    },
    end(): void {
      if (!terminal) invalidOutput("agent.turn ended without a business terminal event");
    },
  };
}

function invalidOutput(message: string): never {
  throw new RpcError("invalid-output", message);
}

function invalid(message: string): never {
  throw new RpcError("invalid-frame", message);
}
