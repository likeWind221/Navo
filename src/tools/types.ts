import type { ToolCallId } from "../brand/ids.js";
import type {
  JsonObject,
  JsonValue,
  TextContentBlock,
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
}

/** Current minimal model-facing output contract for native tools. */
export type ToolOutput = string | readonly TextContentBlock[];

export interface ToolExecutionSuccess {
  readonly kind: "success";
  readonly block: ToolResultContentBlock & { readonly isError: false };
}

export interface ToolExecutionFailure {
  readonly kind: "failure";
  readonly block: ToolResultContentBlock & { readonly isError: true };
  readonly failure: ToolFailure;
}

export type ToolFailureCode =
  | "unknown-tool"
  | "invalid-arguments"
  | "tool-failed"
  | "cancelled";

/** Serializable diagnostic kept outside the model-facing result block. */
export interface ToolFailure {
  readonly code: ToolFailureCode;
  readonly message: string;
  readonly details?: JsonValue;
}
