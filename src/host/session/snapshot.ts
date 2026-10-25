import type { Context } from "cordis";

import type { SessionContextSnapshotV1 } from "../../../rpc/session.js";
import { createGenerateRequest } from "../../agent/request.js";
import type { SessionId } from "../../brand/ids.js";
import { resolveContextBudget } from "../../context/budget.js";
import { measureContext } from "../../context/meter.js";
import { sessionFailure } from "./failure.js";

const QUERY_SIGNAL = new AbortController().signal;

export function createSessionContextSnapshot(
  ctx: Context,
  sessionId: SessionId,
): SessionContextSnapshotV1 {
  const context = resolveContext(ctx, sessionId);
  const request = createGenerateRequest(ctx, {
    sessionId,
    model: context.model,
    systemPrompt: context.systemPrompt,
      ...(context.buildTurnContext === undefined ? {} : { buildTurnContext: context.buildTurnContext }),
    toolNames: context.toolNames,
  }, QUERY_SIGNAL);
  const events = ctx.sessions.getEvents(sessionId);
  const measurement = measureContext(events, request);
  const surface = ctx.sessions.getSurfaceSnapshot(sessionId);
  const budget = resolveContextBudget(context.model);
  return {
    sessionId,
    eventSequence: events.length,
    surfaceGeneration: surface.generation,
    measuredAt: new Date().toISOString(),
    measurement: {
      usedTokens: measurement.usedTokens,
      estimatedRequestTokens: measurement.estimatedRequestTokens,
      basis: measurement.basis,
    },
    budget: budget.kind === "disabled"
      ? { kind: "disabled", reason: budget.reason }
      : {
          kind: "enabled",
          ...(budget.contextWindow === undefined ? {} : { contextWindow: budget.contextWindow }),
          reservedOutputTokens: budget.reservedOutputTokens,
          thresholdTokens: budget.thresholdTokens,
          retainTokens: budget.retainTokens,
          exceeded: measurement.usedTokens >= budget.thresholdTokens,
        },
  };
}

function resolveContext(ctx: Context, sessionId: SessionId) {
  try {
    return ctx.sessionContexts.resolve(sessionId);
  } catch (error: unknown) {
    process.stderr.write(`[kernel-host] session context unavailable for ${sessionId}: ${describe(error)}\n`);
    throw sessionFailure("session-context-unavailable", "Session context is unavailable.");
  }
}

function describe(error: unknown): string {
  return error instanceof Error ? `${error.name}: ${error.message}` : "Unknown failure";
}
