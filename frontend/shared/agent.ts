import type { AgentTurnEvent, AgentTurnInput } from "../../rpc/agent.js";

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

