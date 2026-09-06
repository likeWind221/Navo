import { useCallback, useEffect, useReducer, useRef } from "react";

import { DesktopAgentCommandError } from "../agent/desktop-agent-contract.js";
import type { DesktopAgentApi, DesktopAgentFailure } from "../agent/desktop-agent-contract.js";
import type { DesktopAgentTurnUpdate } from "../agent/desktop-agent-contract.js";
import {
  conversationReducer,
  initialConversationState,
} from "./conversation-state.js";
import type { ConversationState } from "./conversation-state.js";

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
  const cancellingRequest = useRef<string | null>(null);

  useEffect(() => {
    if (api === undefined) return;
    const cleanup = api.onTurnUpdate((update) => {
      if (update.requestId !== activeRequest.current) return;
      if (isTerminalUpdate(update)) {
        activeRequest.current = null;
        cancellingRequest.current = null;
      }
      dispatch({ type: "turn-update", update });
    });
    return () => {
      cleanup();
      const requestId = activeRequest.current;
      activeRequest.current = null;
      cancellingRequest.current = null;
      if (requestId !== null) void api.cancelTurn(requestId).catch(() => undefined);
    };
  }, [api]);

  const send = useCallback((candidate: string): boolean => {
    const text = candidate.trim();
    if (text.length === 0 || activeRequest.current !== null) return false;
    const requestId = crypto.randomUUID();
    activeRequest.current = requestId;
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

  const cancel = useCallback((): boolean => {
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

  return { state, isBusy: state.activeTurn !== null, send, cancel };
}

function isTerminalUpdate(update: DesktopAgentTurnUpdate): boolean {
  return update.type === "bridge-error"
    || update.event.type === "completed"
    || update.event.type === "cancelled"
    || update.event.type === "failed"
    || update.event.type === "truncated";
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
