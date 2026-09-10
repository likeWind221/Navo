export type TurnEvent = TurnLifecycleEvent | StepEvent | ContentEvent | ToolEvent | CommandEvent;

export type TurnLifecycleEvent = TurnScope & (
  | { readonly type: "turn-started" }
  | { readonly type: "turn-completed" | "turn-cancelled" | "turn-truncated" }
  | { readonly type: "turn-failed"; readonly failure: DisplayFailure }
);

export type StepEvent = StepScope & { readonly type: "step-started" | "step-completed" };

export type ContentEvent = ContentScope & (
  | { readonly type: "content-started"; readonly kind: "text" | "reasoning" }
  | { readonly type: "content-started"; readonly kind: "tool-call";
      readonly toolCallId: string; readonly toolName: string }
  | { readonly type: "content-delta"; readonly delta: string }
  | { readonly type: "content-completed" }
);

export type ToolEvent = ContentScope & { readonly toolCallId: string } & (
  | { readonly type: "tool-started" }
  | { readonly type: "tool-result"; readonly status: "succeeded"; readonly summary: string; readonly detail: string }
  | { readonly type: "tool-result"; readonly status: "failed" | "cancelled";
      readonly summary: string; readonly detail: string; readonly failure: DisplayFailure }
);

export type CommandEvent = CommandScope & (
  | { readonly type: "command-started" }
  | { readonly type: "command-completed"; readonly summary: string }
  | { readonly type: "command-failed"; readonly failure: DisplayFailure }
  | { readonly type: "command-cancelled" }
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

export interface ContentScope extends StepScope {
  readonly contentIndex: number;
}

export interface CommandScope {
  readonly sessionId: string;
  readonly commandId: string;
  readonly name: string;
  readonly anchor: CommandAnchor;
}

export type CommandAnchor =
  | { readonly kind: "turn"; readonly turnId: string }
  | { readonly kind: "session" };

export interface DisplayFailure {
  readonly code: string;
  readonly message: string;
}

export const DISPLAY_SUMMARY_MAX_CHARS = 4_096;
export const CONTENT_DELTA_MAX_CHARS = 16_384;
export const CONTENT_MAX_CHARS = 262_144;
export const CONTENT_TURN_MAX_CHARS = 1_048_576;
export const CONTENT_MAX_COUNT = 1_024;

export const CONTENT_MAX_EVENTS = 65_536;
export const TOOL_DETAIL_MAX_CHARS = 65_536;
