import { Context } from "cordis";
import { describe, expect, it } from "vitest";

import { createMessageId, createSessionId } from "../../src/brand/ids.js";
import type { GenerateRequest } from "../../src/llm/types.js";
import { inspectContextPressure, publishContextPressure } from "../../src/context/pressure.js";

const sessionId = createSessionId("pressure-session");
const model = { provider: "mock", model: "test", maxTokens: 1_000, contextWindow: 50_000 } as const;

function request(text: string): GenerateRequest {
  return {
    provider: "mock",
    model: "test",
    messages: [{
      id: createMessageId("pressure-message"),
      role: "user",
      content: [{ type: "text", text }],
    }],
    tools: [],
  };
}

describe("context pressure inspection", () => {
  it("does not trigger when the request remains below the configured threshold", () => {
    expect(inspectContextPressure(sessionId, [], request("short request"), model))
      .toMatchObject({ kind: "within-budget", pressure: { exceeded: false } });
  });

  it("returns a pressure trigger with the exact request's measurement when the threshold is reached", () => {
    const inspection = inspectContextPressure(sessionId, [], request("x".repeat(140_000)), model);
    expect(inspection).toMatchObject({
      kind: "exceeded",
      event: {
        sessionId,
        provider: "mock",
        model: "test",
        thresholdTokens: 32_616,
        retainTokens: 6_523,
        basis: "estimate",
      },
    });
    if (inspection.kind !== "exceeded") throw new Error("Expected an exceeded pressure decision.");
    expect(inspection.event.usedTokens).toBeGreaterThanOrEqual(inspection.event.thresholdTokens);
  });

  it("disables pressure inspection when the model has no capacity configuration", () => {
    expect(inspectContextPressure(sessionId, [], request("short"), { provider: "mock", model: "test" }))
      .toEqual({ kind: "disabled", reason: "missing-capacity" });
  });

  it("publishes only exceeded decisions as the pressure-stage trigger", () => {
    const ctx = new Context();
    const observed: unknown[] = [];
    ctx.on("context/pressure", (event) => observed.push(event));

    publishContextPressure(ctx, inspectContextPressure(sessionId, [], request("short"), model));
    expect(observed).toHaveLength(0);

    publishContextPressure(ctx, inspectContextPressure(sessionId, [], request("x".repeat(140_000)), model));
    expect(observed).toHaveLength(1);
    expect(observed[0]).toMatchObject({ sessionId, provider: "mock", model: "test" });
  });
});
