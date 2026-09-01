import type { MessageId, ToolCallId } from "../brand/ids.js";

/** Raw, provider-independent chunks emitted by one model stream. */
export type StreamChunk =
  | BlockStartChunk
  | TextDeltaChunk
  | ReasoningDeltaChunk
  | ToolCallDeltaChunk
  | BlockEndChunk
  | UsageChunk
  | FinishChunk;

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

export type ContentBlock =
  | TextContentBlock
  | ReasoningContentBlock
  | ToolCallContentBlock
  | ToolResultContentBlock;

export interface Message {
  readonly id: MessageId;
  readonly role: MessageRole;
  readonly content: readonly ContentBlock[];
}

export type UserMessage = Message & { readonly role: "user" };

export type AssistantMessage = Message & { readonly role: "assistant" };

export type ToolResultMessage = UserMessage & {
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

/** Model-emittable blocks carried by `block-end`. */
export type StreamContentBlock =
  | TextContentBlock
  | ReasoningContentBlock
  | ToolCallContentBlock;

export type StreamContentBlockType = StreamContentBlock["type"];

export interface BlockStartChunk {
  readonly type: "block-start";
  readonly index: number;
  readonly blockType: StreamContentBlockType;
}

export interface TextDeltaChunk {
  readonly type: "text-delta";
  readonly index: number;
  readonly text: string;
}

export interface ReasoningDeltaChunk {
  readonly type: "reasoning-delta";
  readonly index: number;
  readonly text: string;
}

export interface ToolCallDeltaChunk {
  readonly type: "tool-call-delta";
  readonly index: number;
  readonly id: ToolCallId;
  readonly name?: string;
  readonly argumentsDelta: string;
}

export interface BlockEndChunk {
  readonly type: "block-end";
  readonly index: number;
  readonly block: StreamContentBlock;
}

export interface UsageChunk {
  readonly type: "usage";
  readonly usage: TokenUsage;
}

export interface FinishChunk {
  readonly type: "finish";
  readonly reason: FinishReason;
}

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
