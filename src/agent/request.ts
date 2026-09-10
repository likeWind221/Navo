import type { Context } from "cordis";

import type { MessageId, StepId } from "../brand/ids.js";
import { collectStream } from "../llm/collect.js";
import type { FinishReason, GenerateRequest } from "../llm/types.js";
import { createDeadline } from "./limits.js";
import type { RetryableAttempt } from "./limits.js";
import type { ModelCompletion, TurnScope } from "./types.js";

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
    turn.output.beginAttempt();
    let publishedContent = false;
    const collected = await collectStream(ctx.llm.stream(request), async (event) => {
      const published = await turn.output.model(event);
      publishedContent = published || publishedContent;
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
  input: TurnScope["input"],
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
  sessionId: TurnScope["input"]["sessionId"],
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
