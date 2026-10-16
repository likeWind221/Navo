import type { TurnModelConfig } from "../agent/types.js";
import type { ContextMeasurement } from "./meter.js";

export type ContextBudget = EnabledContextBudget | DisabledContextBudget;

export interface EnabledContextBudget {
  readonly kind: "enabled";
  readonly contextWindow?: number;
  readonly reservedOutputTokens: number;
  readonly thresholdTokens: number;
  readonly retainTokens: number;
}

export interface DisabledContextBudget {
  readonly kind: "disabled";
  readonly reason: ContextBudgetDisabledReason;
}

export type ContextBudgetDisabledReason = "missing-capacity" | "no-pressure-budget";

export interface ContextPressure {
  readonly usedTokens: number;
  readonly thresholdTokens: number;
  readonly contextWindow?: number;
  readonly exceeded: boolean;
}

export const THRESHOLD_RATIO = 0.8;
export const RETAIN_RATIO = 0.16;
export const LIMIT_RETAIN_RATIO = 0.2;
export const HEADROOM_TOKENS = 16_384;
export const DEFAULT_RESERVED_OUTPUT_TOKENS = 32_768;

export function resolveContextBudget(model: TurnModelConfig): ContextBudget {
  const window = model.contextWindow;
  const limit = model.autoCompactLimit;
  const reservedOutputTokens = model.maxTokens ?? DEFAULT_RESERVED_OUTPUT_TOKENS;
  if (window === undefined) {
    if (limit === undefined) return disabled("missing-capacity");
    return budget(undefined, reservedOutputTokens, limit, Math.floor(limit * LIMIT_RETAIN_RATIO));
  }
  const messageBudget = window - reservedOutputTokens;
  const pressureBudget = messageBudget - HEADROOM_TOKENS;
  if (pressureBudget <= 0) return disabled("no-pressure-budget");
  const formulaThreshold = Math.floor(Math.min(window * THRESHOLD_RATIO, pressureBudget));
  const thresholdTokens = limit === undefined ? formulaThreshold : Math.min(formulaThreshold, limit);
  const retainTokens = Math.min(
    Math.floor(messageBudget * RETAIN_RATIO),
    Math.floor(thresholdTokens * LIMIT_RETAIN_RATIO),
  );
  return budget(window, reservedOutputTokens, thresholdTokens, retainTokens);
}

export function contextPressure(budget: EnabledContextBudget, measurement: ContextMeasurement): ContextPressure {
  return Object.freeze({
    usedTokens: measurement.usedTokens,
    thresholdTokens: budget.thresholdTokens,
    ...(budget.contextWindow === undefined ? {} : { contextWindow: budget.contextWindow }),
    exceeded: measurement.usedTokens >= budget.thresholdTokens,
  });
}

function budget(
  contextWindow: number | undefined,
  reservedOutputTokens: number,
  thresholdTokens: number,
  retainTokens: number,
): EnabledContextBudget {
  return Object.freeze({
    kind: "enabled",
    ...(contextWindow === undefined ? {} : { contextWindow }),
    reservedOutputTokens,
    thresholdTokens,
    retainTokens,
  });
}

function disabled(reason: ContextBudgetDisabledReason): DisabledContextBudget {
  return Object.freeze({ kind: "disabled", reason });
}
