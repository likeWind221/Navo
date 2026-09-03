import { randomUUID } from "node:crypto";

import { createMessageId, createStepId, createTurnId } from "../brand/ids.js";
import type { ToolCallId } from "../brand/ids.js";
import type { ToolResultMessage } from "../llm/types.js";
import type {
  ErrorSource,
  Failure,
  TurnEndStatus,
} from "../session/types.js";
import type { ToolExecutionResult } from "../tools/types.js";
import type { TurnResult } from "./types.js";

export type StepOutcome =
  | {
      readonly status: "continue" | "completed" | "cancelled";
      readonly stepId: ReturnType<typeof createStepId>;
    }
  | {
      readonly status: "blocked" | "failed";
      readonly stepId: ReturnType<typeof createStepId>;
      readonly failure: Failure;
      readonly failureSource: ErrorSource;
    };

export function toolResultMessage(
  result: ToolExecutionResult,
): ToolResultMessage {
  return Object.freeze({
    id: createMessageId(randomUUID()),
    role: "user",
    content: [result.block] as const,
  });
}

export function unexecutedToolResultMessage(
  toolCallId: ToolCallId,
): ToolResultMessage {
  return Object.freeze({
    id: createMessageId(randomUUID()),
    role: "user",
    content: [{
      type: "tool-result",
      toolCallId,
      isError: true,
      content: [{
        type: "text",
        text: "Tool call was not executed because the model response reached its output token limit.",
      }],
    }] as const,
  });
}

export function turnResult(
  status: TurnEndStatus,
  turnId: ReturnType<typeof createTurnId>,
  steps: number,
  failure: Failure | undefined,
): TurnResult {
  if (status === "failed" || status === "blocked") {
    return {
      status,
      turnId,
      steps,
      failure: failure ?? runtimeFailure("Missing runtime failure."),
    };
  }
  return { status, turnId, steps };
}

export function runtimeFailure(error: unknown): Failure {
  return {
    code: "runtime-failed",
    message: error instanceof Error ? error.message : String(error),
  };
}
