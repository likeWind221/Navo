import type { AgentTurnInput } from "../../../rpc/index.js";
import { parseAgentTurnInput } from "../../../rpc/index.js";
import type { SessionCommandInput } from "../../../rpc/command.js";
import { parseSessionCommandInput } from "../../../rpc/command.js";
import type { DesktopAgentApi, DesktopAgentEventListener, DesktopAgentTurnListener } from "../../shared/agent.js";
import { DesktopAgentCommandError } from "../../shared/agent/errors.js";
import {
  parseDesktopAgentCommandResult,
  parseDesktopAgentEvent,
  parseDesktopAgentTurnUpdate,
  parseDesktopRequestId,
} from "../../shared/agent/validation.js";
import {
  AGENT_COMMAND_CANCEL_CHANNEL,
  AGENT_COMMAND_START_CHANNEL,
  AGENT_TURN_CANCEL_CHANNEL,
  AGENT_TURN_START_CHANNEL,
  AGENT_TURN_UPDATE_CHANNEL,
} from "../../shared/agent/channels.js";

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
    async startCommand(input: SessionCommandInput): Promise<void> {
      const result = parseDesktopAgentCommandResult(
        await ipc.invoke(AGENT_COMMAND_START_CHANNEL, parseSessionCommandInput(input)),
      );
      if (result.type === "rejected") throw new DesktopAgentCommandError(result.failure);
    },
    async cancelCommand(commandId: string): Promise<void> {
      await ipc.invoke(AGENT_COMMAND_CANCEL_CHANNEL, parseDesktopRequestId(commandId));
    },
    onEvent(listener: DesktopAgentEventListener): () => void {
      const receive = (_event: unknown, candidate: unknown): void => {
        try {
          listener(parseDesktopAgentEvent(candidate));
        } catch {
          reportInvalidUpdate();
        }
      };
      ipc.on(AGENT_TURN_UPDATE_CHANNEL, receive);
      return () => ipc.removeListener(AGENT_TURN_UPDATE_CHANNEL, receive);
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
