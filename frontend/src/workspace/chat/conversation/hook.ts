import { useCallback, useEffect, useReducer, useRef } from "react";

import { DesktopAgentCommandError } from "../../../../shared/agent/errors.js";
import type { DesktopAgentApi, DesktopAgentEvent, DesktopAgentFailure } from "../../../../shared/agent.js";
import {
  conversationReducer,
  initialConversationState,
} from "../conversation.js";
import type { ConversationAction, ConversationState } from "../conversation.js";
import { parseCommand } from "../command.js";

export interface AgentConversationModel {
  readonly state: ConversationState;
  readonly isBusy: boolean;
  send(text: string): boolean;
  cancel(): boolean;
}

export function useAgentConversation(
  api: DesktopAgentApi | undefined = window.desktop?.agent,
): AgentConversationModel {
  const [state, dispatch] = useReducer(conversationReducer, initialConversationState);
  const activeRequest = useRef<string | null>(null);
  const activeCommand = useRef<string | null>(null);
  const lastOperation = useRef<"turn" | "command" | null>(null);
  const cancellingRequest = useRef<string | null>(null);
  const cancellingCommand = useRef<string | null>(null);

  useEffect(() => {
    if (api === undefined) return;
    const cleanup = api.onEvent((update) => {
      const requestId = updateRequestId(update);
      if (requestId !== null && requestId !== activeRequest.current) return;
      const commandId = updateCommandId(update);
      if (commandId !== null && commandId !== activeCommand.current) return;
      if (isTerminalUpdate(update)) {
        if (requestId !== null) {
          activeRequest.current = null;
          cancellingRequest.current = null;
        }
        if (commandId !== null) {
          activeCommand.current = null;
          cancellingCommand.current = null;
        }
        selectRemainingOperation(activeRequest, activeCommand, lastOperation);
      }
      dispatch({ type: "agent-event", update });
    });
    return () => {
      cleanup();
      const requestId = activeRequest.current;
      const commandId = activeCommand.current;
      activeRequest.current = null;
      activeCommand.current = null;
      lastOperation.current = null;
      cancellingRequest.current = null;
      cancellingCommand.current = null;
      if (requestId !== null) void api.cancelTurn(requestId).catch(() => undefined);
      if (commandId !== null) void api.cancelCommand(commandId).catch(() => undefined);
    };
  }, [api]);

  const send = useCallback((candidate: string): boolean => {
    const text = candidate.trim();
    if (text.length === 0) return false;
    const command = parseCommand(text);
    if (command !== null) {
      return startCommand(command, api, activeCommand, activeRequest, lastOperation,
        cancellingCommand, dispatch);
    }
    if (activeRequest.current !== null) return false;
    const requestId = crypto.randomUUID();
    activeRequest.current = requestId;
    lastOperation.current = "turn";
    dispatch({
      type: "turn-submitted",
      requestId,
      userMessageId: `user-${requestId}`,
      assistantMessageId: `assistant-${requestId}`,
      text,
    });
    if (api === undefined) {
      activeRequest.current = null;
      dispatch({
        type: "turn-command-failed",
        requestId,
        failure: commandFailure("bridge-unavailable", "Agent 仅在桌面应用中可用"),
      });
      return true;
    }
    void api.startTurn({ sessionId: "local-session", requestId, text }).catch((error: unknown) => {
      if (activeRequest.current !== requestId) return;
      activeRequest.current = null;
      cancellingRequest.current = null;
      dispatch({
        type: "turn-command-failed",
        requestId,
        failure: commandFailureFrom(error, "start-failed", "无法启动 Agent 请求"),
      });
    });
    return true;
  }, [api]);

  const cancelTurn = useCallback((): boolean => {
    const requestId = activeRequest.current;
    if (requestId === null || cancellingRequest.current === requestId) return false;
    if (api === undefined) return false;
    cancellingRequest.current = requestId;
    void api.cancelTurn(requestId).catch((error: unknown) => {
      if (activeRequest.current !== requestId) return;
      activeRequest.current = null;
      cancellingRequest.current = null;
      dispatch({
        type: "turn-command-failed",
        requestId,
        failure: commandFailureFrom(error, "cancel-failed", "无法停止 Agent 请求"),
      });
    });
    return true;
  }, [api]);

  const cancel = useCallback((): boolean => {
    if (api === undefined) return false;
    const operation = activeOperation(activeRequest, activeCommand, lastOperation);
    if (operation === "command") {
      const commandId = activeCommand.current;
      if (commandId === null || cancellingCommand.current === commandId) return false;
      cancellingCommand.current = commandId;
      void api.cancelCommand(commandId).catch((error: unknown) => {
        if (activeCommand.current !== commandId) return;
        activeCommand.current = null;
        cancellingCommand.current = null;
        selectRemainingOperation(activeRequest, activeCommand, lastOperation);
        dispatch({ type: "agent-event", update: {
          type: "command-error",
          commandId,
          name: "command",
          failure: commandFailureFrom(error, "cancel-failed", "无法停止命令"),
        }});
      });
      return true;
    }
    return cancelTurn();
  }, [api, cancelTurn]);

  return {
    state,
    isBusy: state.activeTurn !== null || state.commands.some((command) => command.status === "running"),
    send,
    cancel,
  };
}

function startCommand(
  candidate: Exclude<ReturnType<typeof parseCommand>, null>,
  api: DesktopAgentApi | undefined,
  activeCommand: { current: string | null },
  activeRequest: { current: string | null },
  lastOperation: { current: "turn" | "command" | null },
  cancellingCommand: { current: string | null },
  dispatch: React.Dispatch<ConversationAction>,
): boolean {
  const commandId = crypto.randomUUID();
  const name = candidate.name;
  if ("failure" in candidate) {
    dispatch({ type: "agent-event", update: { type: "command-error", commandId, name, failure: candidate.failure } });
    return true;
  }
  if (activeCommand.current !== null) return false;
  activeCommand.current = commandId;
  lastOperation.current = "command";
  dispatch({ type: "command-update", event: {
    type: "command-started",
    sessionId: "local-session",
    commandId,
    name,
    anchor: { kind: "session" },
  }});
  if (api === undefined) {
    activeCommand.current = null;
    selectRemainingOperation(activeRequest, activeCommand, lastOperation);
    dispatch({ type: "agent-event", update: {
      type: "command-error",
      commandId,
      name,
      failure: commandFailure("bridge-unavailable", "Command bridge is unavailable"),
    }});
    return true;
  }
  void api.startCommand({
    sessionId: "local-session",
    commandId,
    name,
    args: candidate.args,
  }).catch((error: unknown) => {
    if (activeCommand.current !== commandId) return;
    activeCommand.current = null;
    cancellingCommand.current = null;
    selectRemainingOperation(activeRequest, activeCommand, lastOperation);
    dispatch({ type: "agent-event", update: {
      type: "command-error",
      commandId,
      name,
      failure: commandFailureFrom(error, "start-failed", "无法启动命令"),
    }});
  });
  return true;
}

function activeOperation(
  activeRequest: { readonly current: string | null },
  activeCommand: { readonly current: string | null },
  lastOperation: { readonly current: "turn" | "command" | null },
): "turn" | "command" | null {
  if (activeRequest.current !== null && activeCommand.current !== null) return lastOperation.current ?? "turn";
  if (activeRequest.current !== null) return "turn";
  if (activeCommand.current !== null) return "command";
  return null;
}

function selectRemainingOperation(
  activeRequest: { readonly current: string | null },
  activeCommand: { readonly current: string | null },
  lastOperation: { current: "turn" | "command" | null },
): void {
  lastOperation.current = activeOperation(activeRequest, activeCommand, lastOperation);
}

function updateRequestId(update: DesktopAgentEvent): string | null {
  if (update.type === "turn-event") return update.event.requestId;
  if (update.type === "turn-error") return update.requestId;
  if (update.type === "event" || update.type === "bridge-error") return update.requestId;
  return null;
}

function updateCommandId(update: DesktopAgentEvent): string | null {
  if (update.type === "command-event") return update.event.commandId;
  if (update.type === "command-error") return update.commandId;
  return null;
}

function isTerminalUpdate(update: DesktopAgentEvent): boolean {
  if (update.type === "turn-error") return true;
  if (update.type === "command-error") return true;
  if (update.type === "turn-event") {
    return update.event.type === "turn-completed"
      || update.event.type === "turn-cancelled"
      || update.event.type === "turn-failed"
      || update.event.type === "turn-truncated";
  }
  if (update.type === "command-event") {
    return update.event.type === "command-completed"
      || update.event.type === "command-failed"
      || update.event.type === "command-cancelled";
  }
  return update.type === "bridge-error"
    || (update.type === "event" && (
      update.event.type === "completed"
      || update.event.type === "cancelled"
      || update.event.type === "failed"
      || update.event.type === "truncated"
    ));
}

function commandFailure(code: string, message: string): DesktopAgentFailure {
  return { code, message };
}

function commandFailureFrom(
  error: unknown,
  fallbackCode: string,
  fallbackMessage: string,
): DesktopAgentFailure {
  if (error instanceof DesktopAgentCommandError) return error.failure;
  return commandFailure(fallbackCode, fallbackMessage);
}
