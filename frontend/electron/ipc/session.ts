import { ipcMain } from "electron";
import type { WebContents } from "electron";

import type { DesktopAgentCommandResult, DesktopAgentEvent, DesktopAgentFailure } from "../../shared/agent.js";
import { parseDesktopRequestId } from "../../shared/agent/validation.js";
import {
  AGENT_COMMAND_CANCEL_CHANNEL,
  AGENT_COMMAND_START_CHANNEL,
  AGENT_TURN_CANCEL_CHANNEL,
  AGENT_TURN_START_CHANNEL,
  AGENT_TURN_UPDATE_CHANNEL,
} from "../../shared/agent/channels.js";
import { AgentCommandController } from "./command/controller.js";
import { AgentTurnV2Controller } from "./agent/v2.js";

export function registerAgentSessionIpc(
  turnController: AgentTurnV2Controller,
  commandController: AgentCommandController,
): () => void {
  ipcMain.handle(AGENT_TURN_START_CHANNEL, (event, candidate: unknown) => {
    const failure = turnController.start(createTarget(event.sender), candidate);
    return result(failure);
  });
  ipcMain.handle(AGENT_TURN_CANCEL_CHANNEL, (event, candidate: unknown) => {
    turnController.cancel(event.sender.id, parseDesktopRequestId(candidate));
  });
  ipcMain.handle(AGENT_COMMAND_START_CHANNEL, (event, candidate: unknown) => {
    const failure = commandController.start(createTarget(event.sender), candidate);
    return result(failure);
  });
  ipcMain.handle(AGENT_COMMAND_CANCEL_CHANNEL, (event, candidate: unknown) => {
    commandController.cancel(event.sender.id, parseDesktopRequestId(candidate));
  });
  return () => {
    ipcMain.removeHandler(AGENT_TURN_START_CHANNEL);
    ipcMain.removeHandler(AGENT_TURN_CANCEL_CHANNEL);
    ipcMain.removeHandler(AGENT_COMMAND_START_CHANNEL);
    ipcMain.removeHandler(AGENT_COMMAND_CANCEL_CHANNEL);
  };
}

export function cancelAgentSessionOwner(
  turnController: AgentTurnV2Controller,
  commandController: AgentCommandController,
  ownerId: number,
): void {
  turnController.cancelOwner(ownerId);
  commandController.cancelOwner(ownerId);
}

function createTarget(sender: WebContents) {
  return {
    ownerId: sender.id,
    isDestroyed: () => sender.isDestroyed(),
    send: (update: DesktopAgentEvent) => sender.send(AGENT_TURN_UPDATE_CHANNEL, update),
  };
}

function result(failure: DesktopAgentFailure | null): DesktopAgentCommandResult {
  return failure === null ? { type: "accepted" } : { type: "rejected", failure };
}
