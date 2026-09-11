import type { SessionId, ToolCallId } from "../brand/ids.js";
import type {
  JsonObject,
  JsonValue,
  ToolResultContentBlock,
  ToolSchema,
} from "../llm/types.js";

/** Stable outcome of one accepted tool call. */
export type ToolExecutionResult =
  | ToolExecutionSuccess
  | ToolExecutionFailure;

/** Registration handle; repeated disposal is safe. */
export type ToolRegistration = () => void;

/** Model-visible schema plus the same-process implementation behind it. */
export interface ToolDefinition extends ToolSchema {
  readonly execute: (
    arguments_: JsonObject,
    context: ToolExecutionContext,
  ) => ToolOutput | PromiseLike<ToolOutput>;
}

/** Immutable identity and cooperative cancellation handed to a tool body. */
export interface ToolExecutionContext {
  readonly callId: ToolCallId;
  readonly signal: AbortSignal;
  /** Authoritative caller identity when execution originates from AgentRuntime. */
  readonly sessionId?: SessionId;
}

/** Runtime-owned restrictions applied before a registered tool is dispatched. */
export interface ToolExecutionOptions {
  readonly sessionId?: SessionId;
  readonly allowedTools?: readonly string[];
  readonly onStarted?: () => void | Promise<void>;
}

/** Model-facing text plus optional model-invisible structured data. */
export type ToolOutput = {
  readonly content: string;
  readonly artifact?: JsonValue;
};

export interface ToolExecutionSuccess {
  readonly kind: "success";
  readonly block: ToolResultContentBlock & { readonly isError: false };
  readonly artifact?: JsonValue;
}

export interface ToolExecutionFailure {
  readonly kind: "failure";
  readonly block: ToolResultContentBlock & { readonly isError: true };
  readonly failure: ToolFailure;
}

export type ToolFailureCode =
  | "unknown-tool"
  | "tool-not-allowed"
  | "invalid-arguments"
  | "tool-failed"
  | "cancelled";

/** Serializable diagnostic kept outside the model-facing result block. */
export interface ToolFailure {
  readonly code: ToolFailureCode;
  /** Full same-process diagnostic; never copied to the model by default. */
  readonly message: string;
  /** Explicitly approved, actionable text that may be shown to the model. */
  readonly modelMessage?: string;
  readonly details?: JsonValue;
}
