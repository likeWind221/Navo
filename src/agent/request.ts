import type { Context } from "cordis";

import type { MessageId, StepId } from "../brand/ids.js";
import { collectStream } from "../llm/collect.js";
import type { FinishReason, GenerateRequest, LlmFailure } from "../llm/types.js";
import { createDeadline } from "./limits.js";
import type { RetryableAttempt } from "./limits.js";
import type { ModelCompletion, TurnScope } from "./types.js";
import { inspectContextPressure, publishContextPressure } from "../context/pressure.js";
import { compactSession } from "../context/compaction/compact.js";

export async function requestModel(
  ctx: Context,
  turn: TurnScope,
  stepId: StepId,
  messageId: MessageId,
): Promise<RetryableAttempt<ModelCompletion>> {
  const { input, turnId, signal, limits } = turn;
  const timeoutMs = limits.modelTimeoutMs;
  const deadline = createDeadline(signal, timeoutMs);
  try {
    let request = buildRequest(ctx, input, deadline.signal);
    let pressure = inspectContextPressure(
      input.sessionId,
      ctx.sessions.getEvents(input.sessionId),
      request,
      input.model,
    );
    publishContextPressure(ctx, pressure);
    if (pressure.kind === "exceeded") {
      for (let attempt = 0; attempt < 2 && pressure.kind === "exceeded"; attempt += 1) {
        const compacted = await compactSession(ctx, {
          sessionId: input.sessionId,
          turnId,
          stepId,
          model: input.model,
          request,
          thresholdTokens: pressure.pressure.thresholdTokens,
          retainTokens: pressure.event.retainTokens,
          signal: deadline.signal,
          cancelSignal: signal,
          maxRetries: limits.maxModelRetries,
        });
        if (compacted.kind === "cancelled") {
          if (deadline.timedOut) return { kind: "failed", failure: { code: "TIMEOUT", message: "Context compaction timed out." } };
          return { kind: "cancelled" };
        }
        if (compacted.kind === "failed" || compacted.kind === "no-progress") {
          if (deadline.timedOut) return { kind: "failed", failure: { code: "TIMEOUT", message: "Context compaction timed out." } };
          return { kind: "failed", failure: {
            code: compacted.kind === "failed" ? compacted.code : "context-compaction-no-progress",
            message: compacted.kind === "failed" ? compacted.message : "No safe, useful history prefix can be compacted.",
          } };
        }
        request = buildRequest(ctx, input, deadline.signal);
        pressure = inspectContextPressure(
          input.sessionId,
          ctx.sessions.getEvents(input.sessionId),
          request,
          input.model,
        );
      }
      if (pressure.kind === "exceeded") {
        return { kind: "failed", failure: {
          code: "context-compaction-no-progress",
          message: "Context pressure remains above the configured threshold after two compaction attempts.",
        } };
      }
    }
    appendRequest(ctx, input.sessionId, turnId, stepId, request);
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
          && !finishReason.failure.code.startsWith("subscription_sharing_")
          ? {
              code: "stream-output-interrupted",
              message: finishReason.failure.exposeCode === true
                ? `Model stream failed after publishing live content (${finishReason.failure.code}).`
                : "Model stream failed after publishing live content.",
              ...(finishReason.failure.status === undefined
                ? {} : { status: finishReason.failure.status }),
            }
          : stripInternalFailure(finishReason.failure),
      };
    }
    return {
      kind: "completed",
      value: {
        message: Object.freeze({
          id: messageId,
          role: "assistant",
          content: collected.content,
          ...(collected.replay === undefined ? {} : { replay: collected.replay }),
        }),
        finishReason,
        ...(collected.usage === undefined ? {} : { usage: collected.usage }),
      },
    };
  } finally {
    deadline.dispose();
  }
}

function stripInternalFailure(failure: LlmFailure): LlmFailure {
  const { exposeCode: _exposeCode, ...publicFailure } = failure;
  return publicFailure;
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
    tools: ctx.tools.schemas(input.toolNames, input.sessionId),
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
