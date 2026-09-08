import type { Context } from "cordis";

import type { MessageId, StepId } from "../brand/ids.js";
import { collectStream } from "../llm/collect.js";
import type { FinishReason, GenerateRequest } from "../llm/types.js";
import { createDeadline } from "./limits.js";
import type { RetryableAttempt } from "./limits.js";
import type { ModelCompletion, RunTurnInput, TurnScope } from "./types.js";

/** Executes one deadline-bound provider attempt inside an open Agent Step. */
export async function requestModel(
  ctx: Context,
  turn: TurnScope,
  stepId: StepId,
  messageId: MessageId,
): Promise<RetryableAttempt<ModelCompletion>> {
  const { input, turnId, signal, limits } = turn;
  const timeoutMs = limits.modelTimeoutMs;
  const deadline = createDeadline(signal, timeoutMs);
  const request = buildRequest(ctx, input, deadline.signal);
  appendRequest(ctx, input.sessionId, turnId, stepId, request);
  try {
    let publishedContent = false;
    const collected = await collectStream(ctx.llm.stream(request), async (event) => {
      switch (event.type) {
        case "content-started":
        case "content-completed":
        case "content-delta":
          if (input.onEvent !== undefined
            && await input.onEvent({ ...event, turnId, stepId, messageId }) !== false) {
            publishedContent = true;
          }
          return;
        case "usage":
        case "finished":
          return;
      }
    });
    if (signal.aborted) return { kind: "cancelled" };
    const finishReason: FinishReason = deadline.timedOut
      ? { kind: "error", failure: {
          code: "TIMEOUT",
          message: `Model request timed out after ${timeoutMs}ms.`,
        } }
      : collected.finishReason ?? { kind: "error", failure: {
          code: "stream-incomplete",
          message: "LLM stream ended without a finish chunk.",
        } };
    if (finishReason.kind === "cancelled") {
      return { kind: "cancelled" };
    }
    if (finishReason.kind === "error") {
      return {
        kind: "failed",
        // Missing finish is already non-retryable; retain its shipped v1 code.
        failure: publishedContent && finishReason.failure.code !== "stream-incomplete"
          ? {
              code: "stream-output-interrupted",
              message: "Model stream failed after publishing live content.",
              ...(finishReason.failure.status === undefined
                ? {} : { status: finishReason.failure.status }),
            }
          : finishReason.failure,
      };
    }
    return {
      kind: "completed",
      value: {
        // The message id was fixed when the Step started so the v2 stream
        // can announce it in step-started before any content arrives.
        message: Object.freeze({
          id: messageId,
          role: "assistant",
          content: collected.content,
        }),
        finishReason,
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
    tools: ctx.tools.schemas(input.toolNames),
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
