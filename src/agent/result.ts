import { randomUUID } from "node:crypto";

import { createMessageId, createStepId, createTurnId } from "../brand/ids.js";
import type { ToolResultMessage } from "../llm/types.js";
import type { Failure, StepEndStatus, TurnEndStatus } from "../session/types.js";
import type { ToolExecutionResult } from "../tools/types.js";
import type { TurnResult } from "./types.js";

export type StepOutcome = {
  readonly status: StepEndStatus;
  readonly turnStatus?: TurnEndStatus;
  readonly stepId: ReturnType<typeof createStepId>;
  readonly failure?: Failure;
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
