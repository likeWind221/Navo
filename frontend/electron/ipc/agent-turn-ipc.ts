import { ipcMain } from "electron";
import type { WebContents } from "electron";

import type { DesktopAgentCommandResult, DesktopAgentTurnUpdate } from "../../src/agent/desktop-agent-contract.js";
import { parseDesktopRequestId } from "../../src/agent/desktop-agent-contract.js";
import { AgentTurnController } from "./agent-turn-controller.js";
import {
  AGENT_TURN_CANCEL_CHANNEL,
  AGENT_TURN_START_CHANNEL,
  AGENT_TURN_UPDATE_CHANNEL,
} from "./agent-turn-channels.js";

export function registerAgentTurnIpc(controller: AgentTurnController): () => void {
  ipcMain.handle(AGENT_TURN_START_CHANNEL, (event, candidate: unknown) => {
    const failure = controller.start(createTarget(event.sender), candidate);
    const result: DesktopAgentCommandResult = failure === null
      ? { type: "accepted" }
      : { type: "rejected", failure };
    return result;
  });
  ipcMain.handle(AGENT_TURN_CANCEL_CHANNEL, (event, candidate: unknown) => {
    controller.cancel(event.sender.id, parseDesktopRequestId(candidate));
  });
  return () => {
    ipcMain.removeHandler(AGENT_TURN_START_CHANNEL);
    ipcMain.removeHandler(AGENT_TURN_CANCEL_CHANNEL);
  };
}

function createTarget(sender: WebContents) {
  return {
    ownerId: sender.id,
    isDestroyed: () => sender.isDestroyed(),
    send: (update: DesktopAgentTurnUpdate) => {
      sender.send(AGENT_TURN_UPDATE_CHANNEL, update);
    },
  };
}
