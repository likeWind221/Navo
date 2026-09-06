import type { AgentTurnEvent, AgentTurnInput } from "../../../rpc/index.js";
import {
  exactKeys,
  parseAgentTurnEvent,
  requireBoundedString,
  requireRecord,
} from "../../../rpc/index.js";

export interface DesktopAgentApi {
  startTurn(input: AgentTurnInput): Promise<void>;
  cancelTurn(requestId: string): Promise<void>;
  onTurnUpdate(listener: DesktopAgentTurnListener): () => void;
}

export type DesktopAgentCommandResult = DesktopAgentCommandAccepted | DesktopAgentCommandRejected;

export interface DesktopAgentCommandAccepted {
  readonly type: "accepted";
}

export interface DesktopAgentCommandRejected {
  readonly type: "rejected";
  readonly failure: DesktopAgentFailure;
}

export type DesktopAgentTurnListener = (update: DesktopAgentTurnUpdate) => void;

export type DesktopAgentTurnUpdate = DesktopAgentEventUpdate | DesktopAgentErrorUpdate;

export interface DesktopAgentEventUpdate {
  readonly type: "event";
  readonly requestId: string;
  readonly event: AgentTurnEvent;
}

export interface DesktopAgentErrorUpdate {
  readonly type: "bridge-error";
  readonly requestId: string;
  readonly failure: DesktopAgentFailure;
}

export interface DesktopAgentFailure {
  readonly code: string;
  readonly message: string;
}

export class DesktopAgentCommandError extends Error {
  constructor(readonly failure: DesktopAgentFailure) {
    super(failure.message);
    this.name = "DesktopAgentCommandError";
  }
}

export function parseDesktopAgentCommandResult(value: unknown): DesktopAgentCommandResult {
  const result = requireRecord(value, "desktop agent command result");
  if (result.type === "accepted" && exactKeys(result, ["type"])) return { type: "accepted" };
  if (result.type === "rejected" && exactKeys(result, ["type", "failure"])) {
    return { type: "rejected", failure: parseDesktopAgentFailure(result.failure) };
  }
  throw new Error("Malformed desktop agent command result");
}

export function parseDesktopAgentTurnUpdate(value: unknown): DesktopAgentTurnUpdate {
  const update = requireRecord(value, "desktop agent turn update");
  const requestId = parseDesktopRequestId(update.requestId);
  if (update.type === "event" && exactKeys(update, ["type", "requestId", "event"])) {
    return { type: "event", requestId, event: parseAgentTurnEvent(update.event) };
  }
  if (update.type === "bridge-error" && exactKeys(update, ["type", "requestId", "failure"])) {
    const failure = parseDesktopAgentFailure(update.failure);
    return {
      type: "bridge-error",
      requestId,
      failure,
    };
  }
  throw new Error("Malformed desktop agent turn update");
}

function parseDesktopAgentFailure(value: unknown): DesktopAgentFailure {
  const failure = requireRecord(value, "desktop agent failure");
  if (!exactKeys(failure, ["code", "message"])) throw new Error("Malformed desktop agent failure");
  return {
    code: requireBoundedString(failure.code, "failure code", 128),
    message: requireBoundedString(failure.message, "failure message", 2_048),
  };
}

export function parseDesktopRequestId(value: unknown): string {
  return requireBoundedString(value, "requestId", 128);
}
