import type { DisplayFailure } from "./failure.js";

export type AssistantEvent = TurnEvent | StepEvent | BlockEvent | ToolEvent;

export type TurnEvent = TurnScope & (
  | { readonly type: "turn-started" }
  | { readonly type: "turn-completed" | "turn-cancelled" | "turn-truncated" }
  | { readonly type: "turn-failed"; readonly failure: DisplayFailure }
);

export type StepEvent = StepScope & { readonly type: "step-started" | "step-completed" };

export type BlockEvent = BlockScope & (
  | { readonly type: "block-started"; readonly kind: "text" | "reasoning" }
  | { readonly type: "block-started"; readonly kind: "tool-call";
      readonly toolCallId: string; readonly toolName: string }
  | { readonly type: "block-delta"; readonly delta: string }
  | { readonly type: "block-completed" }
);

export type ToolEvent = BlockScope & { readonly toolCallId: string } & (
  | { readonly type: "tool-started" }
  | { readonly type: "tool-result"; readonly status: "succeeded"; readonly summary: string; readonly detail: string }
  | { readonly type: "tool-result"; readonly status: "failed" | "cancelled";
      readonly summary: string; readonly detail: string; readonly failure: DisplayFailure }
);

export interface TurnScope {
  readonly sessionId: string;
  readonly requestId: string;
  readonly turnId: string;
}

export interface StepScope extends TurnScope {
  readonly stepId: string;
  readonly messageId: string;
}

export interface BlockScope extends StepScope {
  readonly blockId: string;
}

export const CONTENT_DELTA_MAX_CHARS = 16_384;
export const CONTENT_BLOCK_MAX_CHARS = 262_144;
export const CONTENT_TURN_MAX_CHARS = 1_048_576;
export const CONTENT_MAX_STEPS = 128;
export const CONTENT_MAX_BLOCKS = 1_024;
export const CONTENT_MAX_EVENTS = 65_536;
export const TOOL_DETAIL_MAX_CHARS = 65_536;

