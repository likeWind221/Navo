import type { TurnModelConfig } from "../../src/agent/types.js";

export const PROVIDER = "openai";
export const MODEL = "gpt-6-sol";
export const AUTO_COMPACT_LIMIT = 32_768;
export const REQUEST_LIMIT = 48;
export const ACCEPTANCE_TIMEOUT_MS = 20 * 60 * 1_000;
export const MAX_STEPS = 16;
export const MAX_MODEL_RETRIES = 0;
export const BATCH_COUNT = 10;
export const RECORDS_PER_BATCH = 8;
export const MIN_PRESSURE_COMPACTIONS = 2;
export const BASELINE_LIMIT = Math.floor(AUTO_COMPACT_LIMIT * 0.25);
export const MIN_DATA_TOKENS = 60_000;
export const MAX_DATA_TOKENS = 80_000;

export const PROJECT_GOAL = "Reconcile ten fictional synthetic ledger batches from the provided workspace files into a verified summary and final result. Do not use the internet; all values come from the provided files.";

export function acceptanceModel(): TurnModelConfig {
  return Object.freeze({
    provider: PROVIDER,
    model: MODEL,
    autoCompactLimit: AUTO_COMPACT_LIMIT,
  });
}
