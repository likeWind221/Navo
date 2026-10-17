import type { Context } from "cordis";

import type { SessionId } from "../brand/ids.js";
import type { TurnModelConfig } from "../agent/types.js";
import type { GenerateRequest } from "../llm/types.js";
import type { SessionEvent } from "../session/types.js";
import { contextPressure, resolveContextBudget } from "./budget.js";
import type { ContextBudgetDisabledReason, ContextPressure } from "./budget.js";
import { measureContext } from "./meter.js";

export interface ContextPressureEvent {
  readonly sessionId: SessionId;
  readonly provider: string;
  readonly model: string;
  readonly usedTokens: number;
  readonly thresholdTokens: number;
  readonly contextWindow?: number;
  readonly retainTokens: number;
  readonly estimatedRequestTokens: number;
  readonly basis: "usage" | "estimate";
}

export type ContextPressureInspection =
  | { readonly kind: "disabled"; readonly reason: ContextBudgetDisabledReason }
  | { readonly kind: "within-budget"; readonly pressure: ContextPressure }
  | { readonly kind: "exceeded"; readonly pressure: ContextPressure; readonly event: ContextPressureEvent };

declare module "cordis" {
  interface Events {
    "context/pressure": (event: ContextPressureEvent) => void;
  }
}

/** Measure the exact request envelope before it is recorded or sent to the model. */
export function inspectContextPressure(
  sessionId: SessionId,
  events: readonly SessionEvent[],
  request: GenerateRequest,
  model: TurnModelConfig,
): ContextPressureInspection {
  const budget = resolveContextBudget(model);
  if (budget.kind === "disabled") return { kind: "disabled", reason: budget.reason };

  const measurement = measureContext(events, request);
  const pressure = contextPressure(budget, measurement);
  if (!pressure.exceeded) return { kind: "within-budget", pressure };

  return {
    kind: "exceeded",
    pressure,
    event: Object.freeze({
      sessionId,
      provider: request.provider,
      model: request.model,
      usedTokens: pressure.usedTokens,
      thresholdTokens: pressure.thresholdTokens,
      ...(pressure.contextWindow === undefined ? {} : { contextWindow: pressure.contextWindow }),
      retainTokens: budget.retainTokens,
      estimatedRequestTokens: measurement.estimatedRequestTokens,
      basis: measurement.basis,
    }),
  };
}

/** Publish the pressure decision as an ephemeral trigger for the compaction stage. */
export function publishContextPressure(ctx: Context, inspection: ContextPressureInspection): void {
  if (inspection.kind === "exceeded") ctx.emit("context/pressure", inspection.event);
}
