import type {
  AssistantMessage,
  FinishReason,
  JsonValue,
  Message,
  ToolCallContentBlock,
  ToolResultMessage,
  ToolSchema,
  TokenUsage,
  UserMessage,
} from "../llm/types.js";
import type {
  EventId,
  SessionId,
  StepId,
  ToolCallId,
  TurnId,
} from "../brand/ids.js";

/** Every fact that can be committed to a session log. */
export type SessionEvent = MessageEvent | LogOnlyEvent;

/** Events that contribute a complete message to the model-visible history. */
export type MessageEvent =
  | UserMessageEvent
  | AssistantMessageEvent
  | ToolCallResultEvent;

/** Events retained for lifecycle, audit, and replay but not model messages. */
export type LogOnlyEvent =
  | TurnStartedEvent
  | TurnEndedEvent
  | StepStartedEvent
  | StepEndedEvent
  | LlmRequestedEvent
  | ToolCallRequestedEvent
  | ErrorEvent;

/** A committed, ordered fact in a session log. */
export interface EventRecord<TType extends string, TData> {
  readonly id: EventId;
  readonly sessionId: SessionId;
  readonly sequence: number;
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
  readonly type: TType;
  readonly data: TData;
}

export type TurnEndStatus = "completed" | "blocked" | "cancelled" | "failed";

export type StepEndStatus = "completed" | "continue" | "cancelled" | "failed";

export type TurnStartedEvent = EventRecord<
  "turn-started",
  { readonly turnId: TurnId }
>;

export type TurnEndedEvent = EventRecord<
  "turn-ended",
  { readonly turnId: TurnId; readonly status: TurnEndStatus }
>;

export type StepStartedEvent = EventRecord<
  "step-started",
  { readonly turnId: TurnId; readonly stepId: StepId }
>;

export type StepEndedEvent = EventRecord<
  "step-ended",
  {
    readonly turnId: TurnId;
    readonly stepId: StepId;
    readonly status: StepEndStatus;
  }
>;

export type UserMessageEvent = EventRecord<
  "user-message",
  { readonly message: UserMessage }
>;

/** Serializable request snapshot; operation controls such as AbortSignal are excluded. */
export type LlmRequestedEvent = EventRecord<
  "llm-requested",
  {
    readonly turnId: TurnId;
    readonly stepId: StepId;
    readonly provider: string;
    readonly model: string;
    readonly messages: readonly Message[];
    readonly tools?: readonly ToolSchema[];
    readonly temperature?: number;
    readonly maxTokens?: number;
  }
>;

export type AssistantMessageEvent = EventRecord<
  "assistant-message",
  {
    readonly turnId: TurnId;
    readonly stepId: StepId;
    readonly message: AssistantMessage;
    readonly finishReason: FinishReason;
    readonly usage?: TokenUsage;
  }
>;

export type ToolCallRequestedEvent = EventRecord<
  "tool-call-requested",
  {
    readonly turnId: TurnId;
    readonly stepId: StepId;
    readonly toolCall: ToolCallContentBlock;
  }
>;

export type ToolCallResultEvent = EventRecord<
  "tool-call-result",
  {
    readonly turnId: TurnId;
    readonly stepId: StepId;
    readonly message: ToolResultMessage;
  }
>;

/** Serializable failure detail; never stores an Error instance. */
export interface Failure {
  readonly code: string;
  readonly message: string;
  readonly details?: JsonValue;
}

export type ErrorEvent = EventRecord<
  "error",
  {
    readonly turnId: TurnId;
    readonly stepId?: StepId;
    readonly toolCallId?: ToolCallId;
    readonly source: "llm" | "tool" | "runtime";
    readonly failure: Failure;
  }
>;
