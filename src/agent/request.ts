import { randomUUID } from "node:crypto";

import type { Context } from "cordis";

import { createMessageId } from "../brand/ids.js";
import type { StepId } from "../brand/ids.js";
import { collectStream } from "../llm/collect.js";
import type { GenerateRequest } from "../llm/types.js";
import { createDeadline } from "./limits.js";
import type { RetryableAttempt } from "./limits.js";
import type { ModelCompletion, RunTurnInput, TurnScope } from "./types.js";

/** Executes one deadline-bound provider attempt inside an open Agent Step. */
export async function requestModel(
  ctx: Context,
  turn: TurnScope,
  stepId: StepId,
): Promise<RetryableAttempt<ModelCompletion>> {
  const { input, turnId, signal, limits } = turn;
  const timeoutMs = limits.modelTimeoutMs;
  const deadline = createDeadline(signal, timeoutMs);
  const request = buildRequest(ctx, input, deadline.signal);
  appendRequest(ctx, input.sessionId, turnId, stepId, request);
  try {
    const collected = await collectStream(ctx.llm.stream(request));
    if (signal.aborted) return { kind: "cancelled" };
    if (deadline.timedOut) {
      return {
        kind: "failed",
        failure: {
          code: "TIMEOUT",
          message: `Model request timed out after ${timeoutMs}ms.`,
        },
      };
    }
    if (!collected.finishReason) {
      return {
        kind: "failed",
        failure: {
          code: "stream-incomplete",
          message: "LLM stream ended without a finish chunk.",
        },
      };
    }
    if (collected.finishReason.kind === "cancelled") {
      return { kind: "cancelled" };
    }
    if (collected.finishReason.kind === "error") {
      return { kind: "failed", failure: collected.finishReason.failure };
    }
    return {
      kind: "completed",
      value: {
        message: Object.freeze({
          id: createMessageId(randomUUID()),
          role: "assistant",
          content: collected.content,
        }),
        finishReason: collected.finishReason,
        ...(collected.usage === undefined ? {} : { usage: collected.usage }),
      },
    };
  } finally {
    deadline.dispose();
  }
}

function buildRequest(
  ctx: Context,
  input: RunTurnInput,
  signal: AbortSignal,
): GenerateRequest {
  return {
    provider: input.model.provider,
    model: input.model.model,
    messages: ctx.sessions.deriveMessages(input.sessionId, input.systemPrompt),
    tools: ctx.tools.schemas(),
    signal,
    ...(input.model.temperature === undefined
      ? {} : { temperature: input.model.temperature }),
    ...(input.model.maxTokens === undefined
      ? {} : { maxTokens: input.model.maxTokens }),
  };
}

function appendRequest(
  ctx: Context,
  sessionId: RunTurnInput["sessionId"],
  turnId: TurnScope["turnId"],
  stepId: StepId,
  request: GenerateRequest,
): void {
  const { signal: _signal, ...snapshot } = request;
  ctx.sessions.append({
    type: "llm-requested",
    sessionId,
    data: { turnId, stepId, ...snapshot },
  });
}
