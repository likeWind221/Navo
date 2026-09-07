import type { AgentTurnEvent } from "../../../../rpc/index.js";
import type { DesktopAgentFailure, DesktopAgentTurnUpdate } from "../../../shared/agent.js";

export type ConversationMessage = UserConversationMessage | AssistantConversationMessage;

export interface UserConversationMessage {
  readonly id: string;
  readonly role: "user";
  readonly text: string;
}

export interface AssistantConversationMessage {
  readonly id: string;
  readonly role: "assistant";
  readonly text: string;
  readonly status: AssistantMessageStatus;
  readonly failure: DesktopAgentFailure | null;
}

export type AssistantMessageStatus =
  | "waiting"
  | "streaming"
  | "completed"
  | "cancelled"
  | "failed"
  | "truncated";

export interface ActiveConversationTurn {
  readonly requestId: string;
  readonly assistantMessageId: string;
  readonly turnId: string | null;
}

export interface ConversationState {
  readonly messages: readonly ConversationMessage[];
  readonly activeTurn: ActiveConversationTurn | null;
}

export type ConversationAction =
  | {
      readonly type: "turn-submitted";
      readonly requestId: string;
      readonly userMessageId: string;
      readonly assistantMessageId: string;
      readonly text: string;
    }
  | { readonly type: "turn-update"; readonly update: DesktopAgentTurnUpdate }
  | {
      readonly type: "turn-command-failed";
      readonly requestId: string;
      readonly failure: DesktopAgentFailure;
    };

export const initialConversationState: ConversationState = Object.freeze({
  messages: Object.freeze([]),
  activeTurn: null,
});

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
): ConversationState {
  if (action.type === "turn-submitted") return submitTurn(state, action);
  if (action.type === "turn-command-failed") {
    return failActiveTurn(state, action.requestId, action.failure);
  }
  if (state.activeTurn?.requestId !== action.update.requestId) return state;
  if (action.update.type === "bridge-error") {
    return finishTurn(state, "failed", action.update.failure);
  }
  return applyAgentEvent(state, action.update.event);
}

function submitTurn(
  state: ConversationState,
  action: Extract<ConversationAction, { readonly type: "turn-submitted" }>,
): ConversationState {
  if (state.activeTurn !== null || action.text.length === 0) return state;
  return {
    messages: [
      ...state.messages,
      { id: action.userMessageId, role: "user", text: action.text },
      {
        id: action.assistantMessageId,
        role: "assistant",
        text: "",
        status: "waiting",
        failure: null,
      },
    ],
    activeTurn: {
      requestId: action.requestId,
      assistantMessageId: action.assistantMessageId,
      turnId: null,
    },
  };
}

function applyAgentEvent(state: ConversationState, event: AgentTurnEvent): ConversationState {
  if (event.type === "started") {
    return { ...state, activeTurn: { ...requireActive(state), turnId: event.turnId } };
  }
  if (event.type === "text-delta") {
    return updateAssistant(state, (message) => ({
      ...message,
      text: message.text + event.text,
      status: "streaming",
    }));
  }
  if (event.type === "failed") return finishTurn(state, "failed", toConversationFailure(event.failure));
  return finishTurn(state, event.type, null);
}

function failActiveTurn(
  state: ConversationState,
  requestId: string,
  failure: DesktopAgentFailure,
): ConversationState {
  if (state.activeTurn?.requestId !== requestId) return state;
  return finishTurn(state, "failed", failure);
}

function finishTurn(
  state: ConversationState,
  status: Exclude<AssistantMessageStatus, "waiting" | "streaming">,
  failure: DesktopAgentFailure | null,
): ConversationState {
  const updated = updateAssistant(state, (message) => ({ ...message, status, failure }));
  return { ...updated, activeTurn: null };
}

function updateAssistant(
  state: ConversationState,
  update: (message: AssistantConversationMessage) => AssistantConversationMessage,
): ConversationState {
  const active = requireActive(state);
  return {
    ...state,
    messages: state.messages.map((message) => (
      message.id === active.assistantMessageId && message.role === "assistant"
        ? update(message)
        : message
    )),
  };
}

function requireActive(state: ConversationState): ActiveConversationTurn {
  if (state.activeTurn === null) throw new Error("Conversation has no active turn");
  return state.activeTurn;
}

function toConversationFailure(failure: DesktopAgentFailure): DesktopAgentFailure {
  return { code: failure.code, message: failure.message };
}
