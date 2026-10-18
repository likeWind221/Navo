export const NODE_COMPACTING = Object.freeze({
  provider: "mock",
  model: "compaction",
  contextWindow: 24_000,
  maxTokens: 500,
});

export const MAIN_COMPACTING = Object.freeze({
  provider: "mock",
  model: "compaction",
  contextWindow: 28_000,
  maxTokens: 500,
});

export const UNBOUNDED = Object.freeze({ provider: "mock", model: "compaction" });
