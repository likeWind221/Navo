import { describe, expect, it } from "vitest";

import {
  parseDesktopSessionEvent,
  parseDesktopSessionFollowHandle,
  parseDesktopSessionResult,
  parseDesktopSubscriptionId,
} from "../validation.js";

const snapshot = {
  sessionId: "session-1",
  eventSequence: 1,
  surfaceGeneration: 0,
  measuredAt: "2026-10-18T00:00:00.000Z",
  measurement: { usedTokens: 10, estimatedRequestTokens: 12, basis: "estimate" },
  budget: { kind: "disabled", reason: "missing-capacity" },
} as const;

describe("desktop Session contract validation", () => {
  it("validates success and failure results", () => {
    expect(parseDesktopSessionResult({ type: "ok", value: snapshot }, value => value))
      .toEqual({ type: "ok", value: snapshot });
    expect(parseDesktopSessionResult({
      type: "failed",
      failure: {
        code: "history-changed", message: "changed",
        details: { surfaceGeneration: 2 },
      },
    }, value => value)).toEqual({
      type: "failed",
      failure: {
        code: "history-changed", message: "changed",
        details: { surfaceGeneration: 2 },
      },
    });
    expect(() => parseDesktopSessionResult({ type: "ok", value: snapshot, extra: true }, value => value))
      .toThrow();
    expect(() => parseDesktopSessionResult({
      type: "failed",
      failure: { code: "unknown-code", message: "x" },
    }, value => value)).toThrow();
    expect(() => parseDesktopSessionResult({
      type: "failed",
      failure: { code: "history-changed", message: "x", details: "surface" },
    }, value => value)).toThrow();
  });

  it("validates follow handles and subscription identities", () => {
    expect(parseDesktopSessionFollowHandle({ subscriptionId: "sub-1" }))
      .toEqual({ subscriptionId: "sub-1" });
    expect(parseDesktopSubscriptionId("sub-1")).toBe("sub-1");
    expect(() => parseDesktopSessionFollowHandle({ subscriptionId: "" })).toThrow();
    expect(() => parseDesktopSessionFollowHandle({ subscriptionId: "sub-1", extra: true })).toThrow();
    expect(() => parseDesktopSubscriptionId("x".repeat(129))).toThrow();
  });

  it("validates context and follow-error events", () => {
    expect(parseDesktopSessionEvent({
      type: "context-event",
      subscriptionId: "sub-1",
      event: { type: "snapshot", snapshot },
    })).toEqual({
      type: "context-event",
      subscriptionId: "sub-1",
      event: { type: "snapshot", snapshot },
    });
    expect(parseDesktopSessionEvent({
      type: "context-follow-error",
      subscriptionId: "sub-1",
      failure: { code: "host-unavailable", message: "closed" },
    })).toEqual({
      type: "context-follow-error",
      subscriptionId: "sub-1",
      failure: { code: "host-unavailable", message: "closed" },
    });
    expect(() => parseDesktopSessionEvent({
      type: "context-event",
      subscriptionId: "sub-1",
      event: { type: "snapshot" },
    })).toThrow();
    expect(() => parseDesktopSessionEvent({
      type: "context-follow-error",
      subscriptionId: "sub-1",
      failure: { code: "other", message: "closed" },
    })).toThrow();
  });
});
