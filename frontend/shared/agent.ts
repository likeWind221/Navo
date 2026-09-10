import type { AgentTurnEvent, AgentTurnInput } from "../../rpc/agent.js";
import type { AgentTurnV2Event } from "../../rpc/content.js";
import type { SessionCommandInput } from "../../rpc/command.js";
import type { CommandEvent } from "../../shared/content.js";

export interface DesktopAgentApi {
  startTurn(input: AgentTurnInput): Promise<void>;
  cancelTurn(requestId: string): Promise<void>;
  startCommand(input: SessionCommandInput): Promise<void>;
  cancelCommand(commandId: string): Promise<void>;
  onEvent(listener: DesktopAgentEventListener): () => void;
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

export type DesktopAgentEventListener = (update: DesktopAgentEvent) => void;

export type DesktopAgentEvent =
  | DesktopAgentTurnEventUpdate
  | DesktopAgentCommandEventUpdate
  | DesktopAgentTurnErrorUpdate
  | DesktopAgentCommandErrorUpdate
  | DesktopAgentTurnUpdate;

export interface DesktopAgentTurnEventUpdate {
  readonly type: "turn-event";
  readonly event: AgentTurnV2Event;
}

export interface DesktopAgentCommandEventUpdate {
  readonly type: "command-event";
  readonly event: CommandEvent;
}

export interface DesktopAgentTurnErrorUpdate {
  readonly type: "turn-error";
  readonly requestId: string;
  readonly failure: DesktopAgentFailure;
}

export interface DesktopAgentCommandErrorUpdate {
  readonly type: "command-error";
  readonly commandId: string;
  readonly name: string;
  readonly failure: DesktopAgentFailure;
}

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

