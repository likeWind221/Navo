import type { AgentTurnEvent } from "../../../../rpc/index.js";
import type { AgentTurnV2Event } from "../../../../rpc/content.js";
import type { CommandEvent } from "../../../../shared/content.js";
import type {
  DesktopAgentEvent,
  DesktopAgentFailure,
  DesktopAgentTurnUpdate,
} from "../../../shared/agent.js";

export type ConversationMessage = UserConversationMessage | AssistantConversationMessage;

export type AssistantContentBlock = AssistantTextBlock | AssistantReasoningBlock | AssistantToolBlock;

export interface AssistantTextBlock {
  readonly id: string;
  readonly kind: "text";
  readonly text: string;
  readonly status: "streaming" | "completed";
}

export interface AssistantReasoningBlock {
  readonly id: string;
  readonly kind: "reasoning";
  readonly text: string;
  readonly status: "streaming" | "completed";
}

export interface AssistantToolBlock {
  readonly id: string;
  readonly kind: "tool-call";
  readonly toolCallId: string;
  readonly toolName: string;
  readonly arguments: string;
  readonly status: "pending" | "running" | "succeeded" | "failed" | "cancelled";
  readonly summary: string;
  readonly detail: string;
  readonly failure: DesktopAgentFailure | null;
}

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
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly turnId?: string;
  readonly blocks?: readonly AssistantContentBlock[];
}

export interface CommandConversationMessage {
  readonly id: string;
  readonly role: "system";
  readonly commandId: string;
  readonly name: string;
  readonly anchor: CommandEvent["anchor"];
  readonly status: CommandMessageStatus;
  readonly summary: string;
  readonly failure: DesktopAgentFailure | null;
}

export type CommandMessageStatus = "running" | "succeeded" | "failed" | "cancelled";

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
  readonly commands: readonly CommandConversationMessage[];
  readonly timeline: readonly ConversationTimelineEntry[];
  readonly activeTurn: ActiveConversationTurn | null;
}

export type ConversationTimelineEntry =
  | { readonly kind: "message"; readonly id: string }
  | { readonly kind: "command"; readonly id: string };

export type ConversationAction =
  | {
      readonly type: "turn-submitted";
      readonly requestId: string;
      readonly userMessageId: string;
      readonly assistantMessageId: string;
      readonly text: string;
    }
  | { readonly type: "turn-update"; readonly update: DesktopAgentTurnUpdate }
  | { readonly type: "agent-event"; readonly update: DesktopAgentEvent }
  | { readonly type: "command-update"; readonly event: CommandEvent }
  | {
      readonly type: "turn-command-failed";
      readonly requestId: string;
      readonly failure: DesktopAgentFailure;
    };

export const initialConversationState: ConversationState = Object.freeze({
  messages: Object.freeze([]),
  commands: Object.freeze([]),
  timeline: Object.freeze([]),
  activeTurn: null,
});

export function conversationReducer(
  state: ConversationState,
  action: ConversationAction,
  now: number,
): ConversationState {
  if (action.type === "turn-submitted") return submitTurn(state, action, now);
  if (action.type === "turn-command-failed") {
    return failActiveTurn(state, action.requestId, action.failure, now);
  }
  if (action.type === "agent-event") return applyDesktopEvent(state, action.update, now);
  if (action.type === "command-update") return applyCommandEvent(state, action.event);
  if (state.activeTurn?.requestId !== action.update.requestId) return state;
  if (action.update.type === "bridge-error") {
    return finishTurn(state, "failed", action.update.failure, now);
  }
  return applyAgentEvent(state, action.update.event, now);
}

function submitTurn(
  state: ConversationState,
  action: Extract<ConversationAction, { readonly type: "turn-submitted" }>,
  now: number,
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
        startedAt: now,
        endedAt: null,
      },
    ],
    commands: state.commands,
    timeline: [
      ...state.timeline,
      { kind: "message", id: action.userMessageId },
      { kind: "message", id: action.assistantMessageId },
    ],
    activeTurn: {
      requestId: action.requestId,
      assistantMessageId: action.assistantMessageId,
      turnId: null,
    },
  };
}

function applyDesktopEvent(
  state: ConversationState,
  update: DesktopAgentEvent,
  now: number,
): ConversationState {
  if (update.type === "turn-event") return applyTurnV2Event(state, update.event, now);
  if (update.type === "turn-error") return failActiveTurn(state, update.requestId, update.failure, now);
  if (update.type === "command-event") return applyCommandEvent(state, update.event);
  if (update.type === "command-error") {
    return applyCommandFailure(state, update.commandId, update.name, update.failure);
  }
  if (update.type === "event") {
    if (state.activeTurn?.requestId !== update.requestId) return state;
    return applyAgentEvent(state, update.event, now);
  }
  if (state.activeTurn?.requestId !== update.requestId) return state;
  return finishTurn(state, "failed", update.failure, now);
}

function applyTurnV2Event(
  state: ConversationState,
  event: AgentTurnV2Event,
  now: number,
): ConversationState {
  if (state.activeTurn?.requestId !== event.requestId) return state;
  if (event.type !== "turn-started" && state.activeTurn.turnId === null) return state;
  if (event.type !== "turn-started"
    && state.activeTurn.turnId !== null
    && state.activeTurn.turnId !== event.turnId) return state;
  if (event.type === "turn-started") {
    return updateAssistantForRequest(state, event.requestId, (message) => ({
      ...message,
      turnId: event.turnId,
      blocks: message.blocks ?? [],
    }), { ...state.activeTurn, turnId: event.turnId });
  }
  if (event.type === "content-started") {
    const activeMessage = findAssistant(state, event.requestId);
    if (activeMessage?.blocks?.some((block) => block.id === contentId(event))) return state;
    return updateAssistantForRequest(state, event.requestId, (message) => ({
      ...message,
      status: "streaming",
      blocks: [...(message.blocks ?? []), createContentBlock(event)],
    }));
  }
  if (event.type === "content-delta") {
    const activeMessage = findAssistant(state, event.requestId);
    if (!activeMessage?.blocks?.some((block) => block.id === contentId(event))) return state;
    return updateAssistantForRequest(state, event.requestId, (message) => {
      const blocks = (message.blocks ?? []).map((block) => {
        if (block.id !== contentId(event)) return block;
        if (block.kind === "tool-call") return { ...block, arguments: block.arguments + event.delta };
        return { ...block, text: block.text + event.delta, status: "streaming" as const };
      });
      const text = event.delta && findContentKind(message.blocks, event) === "text"
        ? message.text + event.delta : message.text;
      return { ...message, text, status: "streaming", blocks };
    });
  }
  if (event.type === "content-completed") {
    const activeMessage = findAssistant(state, event.requestId);
    if (!activeMessage?.blocks?.some((block) => block.id === contentId(event))) return state;
    return updateAssistantForRequest(state, event.requestId, (message) => ({
      ...message,
      blocks: (message.blocks ?? []).map((block) => (
        block.id !== contentId(event) || block.kind === "tool-call"
          ? block : { ...block, status: "completed" as const }
      )),
    }));
  }
  if (event.type === "tool-started") {
    const activeMessage = findAssistant(state, event.requestId);
    if (!activeMessage?.blocks?.some((block) => block.kind === "tool-call" && block.toolCallId === event.toolCallId)) {
      return state;
    }
    return updateAssistantForRequest(state, event.requestId, (message) => ({
      ...message,
      blocks: (message.blocks ?? []).map((block) => (
        block.kind === "tool-call" && block.toolCallId === event.toolCallId
          ? { ...block, status: "running" } : block
      )),
    }));
  }
  if (event.type === "tool-result") {
    const activeMessage = findAssistant(state, event.requestId);
    if (!activeMessage?.blocks?.some((block) => block.kind === "tool-call" && block.toolCallId === event.toolCallId)) {
      return state;
    }
    return updateAssistantForRequest(state, event.requestId, (message) => ({
      ...message,
      blocks: (message.blocks ?? []).map((block) => (
        block.kind === "tool-call" && block.toolCallId === event.toolCallId
          ? {
              ...block,
              status: event.status,
              summary: event.summary,
              detail: event.detail,
              failure: "failure" in event ? toConversationFailure(event.failure) : null,
            }
          : block
      )),
    }));
  }
  if (event.type === "turn-failed") {
    return finishTurnForRequest(state, event.requestId, "failed", toConversationFailure(event.failure), now);
  }
  if (event.type === "turn-completed") {
    return finishTurnForRequest(state, event.requestId, "completed", null, now);
  }
  if (event.type === "turn-cancelled") {
    return finishTurnForRequest(state, event.requestId, "cancelled", null, now);
  }
  if (event.type === "turn-truncated") {
    return finishTurnForRequest(state, event.requestId, "truncated", null, now);
  }
  return state;
}

function createContentBlock(
  event: Extract<AgentTurnV2Event, { readonly type: "content-started" }>,
): AssistantContentBlock {
  if (event.kind === "tool-call") {
    return {
      id: contentId(event),
      kind: event.kind,
      toolCallId: event.toolCallId,
      toolName: event.toolName,
      arguments: "",
      status: "pending",
      summary: "",
      detail: "",
      failure: null,
    };
  }
  return { id: contentId(event), kind: event.kind, text: "", status: "streaming" };
}

function contentId(event: { readonly requestId: string; readonly stepId: string; readonly contentIndex: number }): string {
  return `${event.requestId}:${event.stepId}:${event.contentIndex}`;
}

function findContentKind(
  blocks: readonly AssistantContentBlock[] | undefined,
  event: Extract<AgentTurnV2Event, { readonly type: "content-delta" }>,
): AssistantContentBlock["kind"] | undefined {
  return blocks?.find((block) => block.id === contentId(event))?.kind;
}

function findAssistant(state: ConversationState, requestId: string): AssistantConversationMessage | undefined {
  const active = state.activeTurn;
  if (active?.requestId !== requestId) return undefined;
  const message = state.messages.find((item) => item.id === active.assistantMessageId);
  return message?.role === "assistant" ? message : undefined;
}

function applyCommandEvent(state: ConversationState, event: CommandEvent): ConversationState {
  const existing = state.commands.find((command) => command.commandId === event.commandId);
  if (existing !== undefined && existing.status !== "running") return state;
  const current: CommandConversationMessage = existing ?? {
    id: `command-${event.commandId}`,
    role: "system",
    commandId: event.commandId,
    name: event.name,
    anchor: event.anchor,
    status: "running",
    summary: "",
    failure: null,
  };
  const next: CommandConversationMessage = event.type === "command-started"
    ? { ...current, anchor: event.anchor, status: "running", failure: null }
    : event.type === "command-completed"
      ? { ...current, anchor: event.anchor, status: "succeeded", summary: event.summary, failure: null }
      : event.type === "command-failed"
        ? { ...current, anchor: event.anchor, status: "failed", failure: toConversationFailure(event.failure) }
        : { ...current, anchor: event.anchor, status: "cancelled", failure: null };
  return {
    ...state,
    commands: existing === undefined
      ? [...state.commands, next]
      : state.commands.map((command) => command.commandId === event.commandId ? next : command),
    timeline: existing === undefined
      ? [...state.timeline, { kind: "command", id: next.id }]
      : state.timeline,
  };
}

function applyCommandFailure(
  state: ConversationState,
  commandId: string,
  name: string,
  failure: DesktopAgentFailure,
): ConversationState {
  const existing = state.commands.find((command) => command.commandId === commandId);
  if (existing !== undefined && existing.status !== "running") return state;
  const next: CommandConversationMessage = existing ?? {
    id: `command-${commandId}`,
    role: "system",
    commandId,
    name,
    anchor: { kind: "session" },
    status: "failed",
    summary: "",
    failure,
  };
  return {
    ...state,
    commands: existing === undefined
      ? [...state.commands, next]
      : state.commands.map((command) => command.commandId === commandId
        ? { ...command, status: "failed", failure } : command),
    timeline: existing === undefined
      ? [...state.timeline, { kind: "command", id: next.id }]
      : state.timeline,
  };
}

function applyAgentEvent(
  state: ConversationState,
  event: AgentTurnEvent,
  now: number,
): ConversationState {
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
  if (event.type === "failed") return finishTurn(state, "failed", toConversationFailure(event.failure), now);
  return finishTurn(state, event.type, null, now);
}

function failActiveTurn(
  state: ConversationState,
  requestId: string,
  failure: DesktopAgentFailure,
  now: number,
): ConversationState {
  if (state.activeTurn?.requestId !== requestId) return state;
  return finishTurn(state, "failed", failure, now);
}

function finishTurn(
  state: ConversationState,
  status: Exclude<AssistantMessageStatus, "waiting" | "streaming">,
  failure: DesktopAgentFailure | null,
  now: number,
): ConversationState {
  const updated = updateAssistant(state, (message) => ({ ...message, status, failure, endedAt: now }));
  return { ...updated, activeTurn: null };
}

function finishTurnForRequest(
  state: ConversationState,
  requestId: string,
  status: Exclude<AssistantMessageStatus, "waiting" | "streaming">,
  failure: DesktopAgentFailure | null,
  now: number,
): ConversationState {
  if (state.activeTurn?.requestId !== requestId) return state;
  return finishTurn(state, status, failure, now);
}

function updateAssistantForRequest(
  state: ConversationState,
  requestId: string,
  update: (message: AssistantConversationMessage) => AssistantConversationMessage,
  activeTurn: ActiveConversationTurn = requireActive(state),
): ConversationState {
  if (activeTurn.requestId !== requestId) return state;
  return {
    ...state,
    messages: state.messages.map((message) => (
      message.id === activeTurn.assistantMessageId && message.role === "assistant"
        ? update(message)
        : message
    )),
    activeTurn,
  };
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
