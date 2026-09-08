import type { MessageId, ToolCallId } from "../brand/ids.js";

/** Canonical, provider-independent events emitted by one model request. */
export type ModelEvent =
  | { readonly type: "content-started"; readonly contentIndex: number;
      readonly contentType: "text" | "reasoning" }
  | { readonly type: "content-started"; readonly contentIndex: number;
      readonly contentType: "tool-call"; readonly toolCallId: ToolCallId }
  | { readonly type: "content-delta"; readonly contentIndex: number;
      readonly contentType: "text" | "reasoning"; readonly delta: string }
  | { readonly type: "content-delta"; readonly contentIndex: number;
      readonly contentType: "tool-call"; readonly toolCallId: ToolCallId;
      readonly toolNameDelta?: string; readonly delta: string }
  | { readonly type: "content-completed"; readonly contentIndex: number;
      readonly contentType: ContentBlockType }
  | { readonly type: "usage"; readonly usage: TokenUsage }
  | { readonly type: "finished"; readonly reason: FinishReason };

export type JsonValue =
  | null
  | boolean
  | number
  | string
  | JsonValue[]
  | JsonObject;

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export type MessageRole = "system" | "user" | "assistant";

/** Complete model-emitted content; never represents a streaming partial. */
export type ContentBlock =
  | TextContentBlock
  | ReasoningContentBlock
  | ToolCallContentBlock;

export type MessageContent = ContentBlock | ToolResultContentBlock;

export interface Message {
  readonly id: MessageId;
  readonly role: MessageRole;
  readonly content: readonly MessageContent[];
}

export type UserMessage = Message & { readonly role: "user" };

export type AssistantMessage = Omit<Message, "role" | "content"> & {
  readonly role: "assistant";
  readonly content: readonly ContentBlock[];
};

export type ToolResultMessage = Omit<UserMessage, "content"> & {
  readonly content: readonly [ToolResultContentBlock];
};

export type FinishReason =
  | { readonly kind: "stop" }
  | { readonly kind: "tool-calls" }
  | { readonly kind: "max-tokens" }
  | { readonly kind: "content-filter" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "error"; readonly failure: LlmFailure };

export interface GenerateRequest {
  readonly provider: string;
  readonly model: string;
  readonly messages: readonly Message[];
  readonly tools?: readonly ToolSchema[];
  readonly temperature?: number;
  readonly maxTokens?: number;
  /** Operation control, not a serializable payload field. */
  readonly signal?: AbortSignal;
}

export type ContentBlockType = ContentBlock["type"];

export type TextContentBlock = {
  readonly type: "text";
  readonly text: string;
};

/** Retained for observability; never used for AgentLoop control flow. */
export type ReasoningContentBlock = {
  readonly type: "reasoning";
  readonly text: string;
};

/** `arguments` is raw model output and may not be valid JSON. */
export type ToolCallContentBlock = {
  readonly type: "tool-call";
  readonly id: ToolCallId;
  readonly name: string;
  readonly arguments: string;
};

export type ToolResultContentBlock = {
  readonly type: "tool-result";
  readonly toolCallId: ToolCallId;
  readonly content: readonly ContentBlock[];
  readonly isError: boolean;
};

export interface ToolSchema {
  readonly name: string;
  readonly description?: string;
  readonly parameters: JsonObject;
}

export interface TokenUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly totalTokens?: number;
  readonly cacheReadTokens?: number;
  readonly cacheWriteTokens?: number;
  readonly reasoningTokens?: number;
}

export interface LlmFailure {
  readonly code: string;
  readonly message: string;
  readonly status?: number;
  readonly retryAfterMs?: number;
}
