import { describe, expect, it } from "vitest";

import { sessionContextMethod } from "../../../rpc/session.js";
import { createGenerateRequest } from "../../../src/agent/request.js";
import { resolveContextBudget } from "../../../src/context/budget.js";
import { measureContext } from "../../../src/context/meter.js";
import { DEFAULT_MODEL, appendAssistant, appendUser, call, failureOf, host, session } from "./helpers.js";

describe("Kernel Host session.context.v1", () => {
  it("measures the same request envelope as a real Turn without mutating the Session", async () => {
    const { ctx, client, adapter } = await host();
    const sessionId = session("context-snapshot");
    appendUser(ctx, sessionId, "context-user", "hello context");
    appendAssistant(ctx, sessionId, "context-assistant", "hello back");
    const beforeEvents = ctx.sessions.getEvents(sessionId);
    const beforeSurface = ctx.sessions.getSurfaceSnapshot(sessionId);

    const snapshot = await call(client, sessionContextMethod, { sessionId: String(sessionId) });

    const context = ctx.sessionContexts.resolve(sessionId);
    const request = createGenerateRequest(ctx, {
      sessionId,
      model: context.model,
      systemPrompt: context.systemPrompt,
      toolNames: context.toolNames,
    }, new AbortController().signal);
    const measurement = measureContext(beforeEvents, request);
    const budget = resolveContextBudget(context.model);
    expect(budget.kind).toBe("enabled");
    if (budget.kind !== "enabled") return;

    expect(snapshot).toEqual({
      sessionId,
      eventSequence: beforeEvents.length,
      surfaceGeneration: beforeSurface.generation,
      measuredAt: snapshot.measuredAt,
      measurement,
      budget: {
        kind: "enabled",
        ...(budget.contextWindow === undefined ? {} : { contextWindow: budget.contextWindow }),
        reservedOutputTokens: budget.reservedOutputTokens,
        thresholdTokens: budget.thresholdTokens,
        retainTokens: budget.retainTokens,
        exceeded: measurement.usedTokens >= budget.thresholdTokens,
      },
    });
    expect(Number.isFinite(Date.parse(snapshot.measuredAt))).toBe(true);
    expect(adapter.requests).toHaveLength(0);
    expect(ctx.sessions.getEvents(sessionId)).toEqual(beforeEvents);
    expect(ctx.sessions.getSurfaceSnapshot(sessionId).generation).toBe(beforeSurface.generation);
  });

  it("reports a disabled budget while preserving measurement", async () => {
    const model = { provider: "mock", model: "mock" };
    const { ctx, client } = await host([], { model });
    const sessionId = session("context-disabled");
    appendUser(ctx, sessionId, "disabled-user", "hello");

    const snapshot = await call(client, sessionContextMethod, { sessionId: String(sessionId) });

    expect(snapshot.measurement.estimatedRequestTokens).toBeGreaterThan(0);
    expect(snapshot.budget).toEqual({ kind: "disabled", reason: "missing-capacity" });
  });

  it("reports no-pressure-budget when the window leaves no room", async () => {
    const model = { provider: "mock", model: "mock", contextWindow: 1_000, maxTokens: 999 };
    const { ctx, client } = await host([], { model });
    const sessionId = session("context-no-room");
    appendUser(ctx, sessionId, "no-room-user", "hello");

    const snapshot = await call(client, sessionContextMethod, { sessionId: String(sessionId) });

    expect(snapshot.budget).toEqual({ kind: "disabled", reason: "no-pressure-budget" });
  });

  it("fails closed when the Session context cannot be resolved", async () => {
    const { ctx, client } = await host([], { agent: false });
    const sessionId = session("context-unresolvable");
    appendUser(ctx, sessionId, "unresolvable-user", "hello");

    expect(await failureOf(client, sessionContextMethod, { sessionId: String(sessionId) }))
      .toMatchObject({ code: "session-context-unavailable" });
  });

  it("matches the configured auto-compact limit", async () => {
    const model = {
      ...DEFAULT_MODEL,
      contextWindow: 100_000,
      autoCompactLimit: 4_000,
    };
    const { ctx, client } = await host([], { model });
    const sessionId = session("context-limit");
    appendUser(ctx, sessionId, "limit-user", "hello");

    const snapshot = await call(client, sessionContextMethod, { sessionId: String(sessionId) });

    expect(snapshot.budget).toMatchObject({ kind: "enabled", thresholdTokens: 4_000 });
  });
});
