import type { AgentTurnInput } from "../../rpc/index.js";
import { parseAgentTurnInput } from "../../rpc/index.js";
import type {
  DesktopAgentApi,
  DesktopAgentTurnListener,
} from "../src/agent/desktop-agent-contract.js";
import {
  DesktopAgentCommandError,
  parseDesktopAgentCommandResult,
  parseDesktopAgentTurnUpdate,
  parseDesktopRequestId,
} from "../src/agent/desktop-agent-contract.js";
import {
  AGENT_TURN_CANCEL_CHANNEL,
  AGENT_TURN_START_CHANNEL,
  AGENT_TURN_UPDATE_CHANNEL,
} from "./ipc/agent-turn-channels.js";

export interface AgentIpcRenderer {
  invoke(channel: string, value: unknown): Promise<unknown>;
  on(channel: string, listener: (event: unknown, value: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, value: unknown) => void): void;
}

export function createDesktopAgentApi(
  ipc: AgentIpcRenderer,
  reportInvalidUpdate: () => void = () => console.error("[preload] dropped invalid Agent turn update"),
): DesktopAgentApi {
  return Object.freeze({
    async startTurn(input: AgentTurnInput): Promise<void> {
      const result = parseDesktopAgentCommandResult(
        await ipc.invoke(AGENT_TURN_START_CHANNEL, parseAgentTurnInput(input)),
      );
      if (result.type === "rejected") throw new DesktopAgentCommandError(result.failure);
    },
    async cancelTurn(requestId: string): Promise<void> {
      await ipc.invoke(AGENT_TURN_CANCEL_CHANNEL, parseDesktopRequestId(requestId));
    },
    onTurnUpdate(listener: DesktopAgentTurnListener): () => void {
      const receive = (_event: unknown, candidate: unknown): void => {
        try {
          listener(parseDesktopAgentTurnUpdate(candidate));
        } catch {
          reportInvalidUpdate();
        }
      };
      ipc.on(AGENT_TURN_UPDATE_CHANNEL, receive);
      return () => ipc.removeListener(AGENT_TURN_UPDATE_CHANNEL, receive);
    },
  });
}
