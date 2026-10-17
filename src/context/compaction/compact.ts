import { randomUUID } from "node:crypto";
import type { Context } from "cordis";

import { createMessageId } from "../../brand/ids.js";
import type { SessionId, StepId, TurnId } from "../../brand/ids.js";
import type { GenerateRequest, UserMessage } from "../../llm/types.js";
import type { TurnModelConfig } from "../../agent/types.js";
import { resolveContextBudget, HEADROOM_TOKENS } from "../budget.js";
import { estimateMessage, measureContext } from "../meter.js";
import { selectCompactablePrefix } from "./selector.js";
import { createCheckpointText, summarize, summaryFixedTokens } from "./summarizer.js";

export type CompactionOutcome =
  | { readonly kind: "compacted"; readonly beforeTokens: number; readonly afterTokens: number; readonly summaryTokens: number }
  | { readonly kind: "no-progress" }
  | { readonly kind: "failed"; readonly code: string; readonly message: string }
  | { readonly kind: "cancelled" };

export interface CompactSessionInput {
  readonly sessionId: SessionId;
  readonly turnId: TurnId;
  readonly stepId: StepId;
  readonly model: TurnModelConfig;
  readonly request: GenerateRequest;
  readonly thresholdTokens: number;
  readonly retainTokens: number;
  readonly signal: AbortSignal;
  readonly cancelSignal: AbortSignal;
  readonly maxRetries: number;
  readonly trigger?: "pressure" | "overflow";
}

export async function compactSession(ctx: Context, input: CompactSessionInput): Promise<CompactionOutcome> {
  const trigger = input.trigger ?? "pressure";
  const budget = resolveContextBudget(input.model);
  if (budget.kind === "disabled" && trigger !== "overflow") return { kind: "no-progress" };
  const snapshot = ctx.sessions.getSurfaceSnapshot(input.sessionId);
  const systemMessages = input.request.messages.filter(message => message.role === "system");
  const summaryMaxTokens = Math.min(
    input.model.maxTokens ?? 8192,
    8192,
    Math.max(256, Math.floor((budget.contextWindow ?? input.thresholdTokens) / 8)),
  );
  const maxInputTokens = budget.kind === "enabled" && budget.contextWindow !== undefined
    ? budget.contextWindow - summaryMaxTokens - HEADROOM_TOKENS
    : input.thresholdTokens - summaryMaxTokens;
  const fixedTokens = summaryFixedTokens(systemMessages);
  const selection = selectCompactablePrefix(
    snapshot.entries,
    trigger === "overflow" ? 0 : input.retainTokens,
    maxInputTokens - fixedTokens,
    Math.ceil(input.thresholdTokens * 0.1),
  );
  if (!selection) return { kind: "no-progress" };

  const compactionId = randomUUID();
  let started = false;
  try {
    ctx.sessions.append({
      type: "compaction-started",
      sessionId: input.sessionId,
      data: {
        turnId: input.turnId,
        compactionId,
        trigger,
        coveredStart: selection.coveredStart,
        coveredEnd: selection.coveredEnd,
      },
    });
    started = true;

    if (input.signal.aborted) {
      return finishFailure(ctx, input, compactionId, "cancelled", "context-compaction-cancelled", "Compaction was cancelled.");
    }
    const summary = await summarize(
      ctx,
      input.model.provider,
      input.model.model,
      [...systemMessages, ...selection.messages],
      summaryMaxTokens,
      input.signal,
      input.maxRetries,
    );
    if (input.cancelSignal.aborted) {
      return finishFailure(ctx, input, compactionId, "cancelled", "context-compaction-cancelled", "Compaction was cancelled.");
    }

    const checkpointMessage: UserMessage = Object.freeze({
      id: createMessageId(randomUUID()),
      role: "user",
      content: [{ type: "text" as const, text: createCheckpointText(summary.text) }],
    });
    const checkpointTokens = estimateMessage(checkpointMessage);
    const savedTokens = selection.estimatedTokens - checkpointTokens;
    const minimumSavings = Math.ceil(input.thresholdTokens * 0.1);
    if (savedTokens < minimumSavings) {
      return finishFailure(ctx, input, compactionId, "failed", "context-compaction-not-shrinking", "The summary did not reduce the selected history enough.");
    }

    const tailMessages = snapshot.entries.slice(selection.coveredEntries.length)
      .flatMap(entry => entry.message === undefined ? [] : [entry.message]);
    const projectedRequest: GenerateRequest = {
      ...input.request,
      messages: [...systemMessages, checkpointMessage, ...tailMessages],
    };
    const events = ctx.sessions.getEvents(input.sessionId);
    const beforeMeasurement = measureContext(events, input.request);
    const projectedMeasurement = measureContext(events, projectedRequest);
    if (projectedMeasurement.usedTokens >= beforeMeasurement.usedTokens
      || beforeMeasurement.usedTokens - projectedMeasurement.usedTokens < minimumSavings) {
      return finishFailure(ctx, input, compactionId, "failed", "context-compaction-no-progress", "The projected replacement would not reduce context pressure enough.");
    }

    ctx.sessions.appendCompactionCheckpoint({
      type: "compaction-checkpoint",
      sessionId: input.sessionId,
      data: {
        turnId: input.turnId,
        compactionId,
        message: checkpointMessage,
        coveredStart: selection.coveredStart,
        coveredEnd: selection.coveredEnd,
        summaryVersion: 1,
      },
    }, snapshot, selection.coveredStart, selection.coveredEnd);

    const actualRequest: GenerateRequest = {
      ...input.request,
      messages: [...systemMessages, ...ctx.sessions.deriveMessages(input.sessionId)],
    };
    const afterMeasurement = measureContext(ctx.sessions.getEvents(input.sessionId), actualRequest);
    if (afterMeasurement.usedTokens >= beforeMeasurement.usedTokens) {
      return finishFailure(ctx, input, compactionId, "failed", "context-compaction-no-progress", "The installed checkpoint did not reduce measured context.");
    }
    ctx.sessions.append({
      type: "compaction-ended",
      sessionId: input.sessionId,
      data: {
        turnId: input.turnId,
        compactionId,
        status: "completed",
        beforeTokens: beforeMeasurement.usedTokens,
        afterTokens: afterMeasurement.usedTokens,
        summaryTokens: summary.estimatedTokens,
        provider: input.model.provider,
        model: input.model.model,
        ...(summary.usage === undefined ? {} : { usage: summary.usage }),
      },
    });
    return {
      kind: "compacted",
      beforeTokens: beforeMeasurement.usedTokens,
      afterTokens: afterMeasurement.usedTokens,
      summaryTokens: summary.estimatedTokens,
    };
  } catch (error: unknown) {
    const sourceCode = error instanceof Error && "code" in error && typeof error.code === "string"
      ? error.code : "context-compaction-failed";
    const code = sourceCode.startsWith("context-compaction") ? sourceCode : "context-compaction-failed";
    const message = error instanceof Error ? error.message : "Compaction failed.";
    if (input.cancelSignal.aborted) {
      if (started) appendEnded(ctx, input, compactionId, "cancelled", code, message);
      return { kind: "cancelled" };
    }
    if (started) appendEnded(ctx, input, compactionId, "failed", code, message);
    return { kind: "failed", code, message };
  }
}

function finishFailure(
  ctx: Context,
  input: CompactSessionInput,
  compactionId: string,
  status: "failed" | "cancelled",
  code: string,
  message: string,
): CompactionOutcome {
  appendEnded(ctx, input, compactionId, status, code, message);
  return status === "cancelled" ? { kind: "cancelled" } : { kind: "failed", code, message };
}

function appendEnded(
  ctx: Context,
  input: CompactSessionInput,
  compactionId: string,
  status: "failed" | "cancelled",
  code: string,
  message: string,
): void {
  ctx.sessions.append({
    type: "compaction-ended",
    sessionId: input.sessionId,
    data: {
      turnId: input.turnId,
      compactionId,
      status,
      provider: input.model.provider,
      model: input.model.model,
      failure: { code, message },
    },
  });
}
