import { describe, expect, it } from "vitest";

import {
  DEFAULT_AGENT_RUNTIME_LIMITS,
  isRetryableModelFailure,
  modelRetryDelayMs,
  resolveAgentRuntimeLimits,
} from "../src/agent/limits.js";

describe("Agent runtime limits", () => {
  it("uses the project Step budget and Harness-compatible model defaults", () => {
    expect(DEFAULT_AGENT_RUNTIME_LIMITS).toEqual({
      maxSteps: 150,
      modelTimeoutMs: 300_000,
      maxModelRetries: 5,
    });
  });

  it("merges per-Turn overrides and validates every value", () => {
    expect(resolveAgentRuntimeLimits({}, { maxSteps: 3 })).toMatchObject({
      maxSteps: 3,
      modelTimeoutMs: 300_000,
    });
    expect(() => resolveAgentRuntimeLimits({}, { maxSteps: 0 }))
      .toThrow(/maxSteps/);
    expect(() => resolveAgentRuntimeLimits({}, { modelTimeoutMs: Infinity }))
      .toThrow(/modelTimeoutMs/);
    expect(() => resolveAgentRuntimeLimits({}, { maxModelRetries: -1 }))
      .toThrow(/maxModelRetries/);
  });

  it("retries only the Harness transient failure classes", () => {
    for (const code of ["EMPTY_RESPONSE", "RATE_LIMIT", "SERVER", "TIMEOUT", "TRANSPORT"]) {
      expect(isRetryableModelFailure({ code, message: code })).toBe(true);
    }
    expect(isRetryableModelFailure({ code: "AUTH", message: "bad key" }))
      .toBe(false);
  });

  it("uses Harness-compatible bounded exponential backoff", () => {
    expect(modelRetryDelayMs({ code: "SERVER", message: "busy" }, 1, () => 0.5))
      .toBe(500);
    expect(modelRetryDelayMs({ code: "SERVER", message: "busy" }, 9, () => 0.5))
      .toBe(10_000);
    expect(modelRetryDelayMs({ code: "RATE_LIMIT", message: "wait", retryAfterMs: 750 }, 1))
      .toBe(750);
  });
});
