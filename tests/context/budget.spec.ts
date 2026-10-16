import { describe, expect, it } from "vitest";

import { contextPressure, resolveContextBudget } from "../../src/context/budget.js";
import type { EnabledContextBudget } from "../../src/context/budget.js";

const model = { provider: "qwen", model: "qwen3.8-27b" } as const;

describe("context budget", () => {
  it("is disabled without a declared window or compaction limit", () => {
    expect(resolveContextBudget({ ...model, maxTokens: 8_192 })).toEqual({ kind: "disabled", reason: "missing-capacity" });
  });

  it("derives the threshold from the window ratio and the retained tail from the message budget", () => {
    expect(resolveContextBudget({ ...model, maxTokens: 8_192, contextWindow: 262_144 })).toEqual({
      kind: "enabled", contextWindow: 262_144, reservedOutputTokens: 8_192,
      thresholdTokens: Math.floor(262_144 * 0.8),
      retainTokens: Math.floor((262_144 - 8_192) * 0.16),
    });
  });

  it("caps the threshold by output reservation plus headroom on small windows", () => {
    const budget = resolveContextBudget({ ...model, maxTokens: 16_384, contextWindow: 40_000 });
    expect(budget).toEqual({
      kind: "enabled", contextWindow: 40_000, reservedOutputTokens: 16_384,
      thresholdTokens: 40_000 - 16_384 - 16_384,
      retainTokens: Math.floor((40_000 - 16_384 - 16_384) * 0.2),
    });
  });

  it("reserves a default output budget when the model has no maxTokens", () => {
    expect(resolveContextBudget({ provider: "openai", model: "gpt-6-luna", contextWindow: 272_000 })).toMatchObject({
      kind: "enabled", reservedOutputTokens: 32_768, thresholdTokens: Math.floor(272_000 * 0.8),
    });
  });

  it("is disabled when output reservation and headroom leave no pressure budget", () => {
    expect(resolveContextBudget({ ...model, maxTokens: 8_192, contextWindow: 24_576 }))
      .toEqual({ kind: "disabled", reason: "no-pressure-budget" });
    expect(resolveContextBudget({ ...model, maxTokens: 8_192, contextWindow: 24_576, autoCompactLimit: 10_000 }))
      .toEqual({ kind: "disabled", reason: "no-pressure-budget" });
  });

  it("lowers the threshold to an explicit compaction limit and keeps the tail below it", () => {
    const budget = resolveContextBudget({ ...model, maxTokens: 8_192, contextWindow: 262_144, autoCompactLimit: 20_000 });
    expect(budget).toMatchObject({ kind: "enabled", thresholdTokens: 20_000, retainTokens: 4_000 });
    expect(resolveContextBudget({ ...model, maxTokens: 8_192, contextWindow: 200_000, autoCompactLimit: 500_000 }))
      .toMatchObject({ thresholdTokens: 160_000 });
  });

  it("enables pressure from the compaction limit alone when the window is unknown", () => {
    expect(resolveContextBudget({ ...model, maxTokens: 8_192, autoCompactLimit: 50_000 })).toEqual({
      kind: "enabled", reservedOutputTokens: 8_192, thresholdTokens: 50_000, retainTokens: 10_000,
    });
  });

  it("reports pressure at and above the threshold", () => {
    const budget = resolveContextBudget({ ...model, autoCompactLimit: 1_000 }) as EnabledContextBudget;
    expect(contextPressure(budget, { usedTokens: 999, estimatedRequestTokens: 999, basis: "estimate" }))
      .toEqual({ usedTokens: 999, thresholdTokens: 1_000, exceeded: false });
    const windowed = resolveContextBudget({ ...model, maxTokens: 8_192, contextWindow: 262_144 }) as EnabledContextBudget;
    expect(contextPressure(windowed, { usedTokens: windowed.thresholdTokens, estimatedRequestTokens: 1, basis: "usage" }))
      .toEqual({ usedTokens: windowed.thresholdTokens, thresholdTokens: windowed.thresholdTokens, contextWindow: 262_144, exceeded: true });
  });
});
