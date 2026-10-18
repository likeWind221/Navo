import { describe, expect, it } from "vitest";

import type { DesktopSessionEvent } from "../../../shared/session.js";
import {
  SESSION_CONTEXT_EVENT_CHANNEL,
  SESSION_CONTEXT_FOLLOW_CANCEL_CHANNEL,
  SESSION_CONTEXT_FOLLOW_START_CHANNEL,
  SESSION_CONTEXT_GET_CHANNEL,
  SESSION_CONTEXT_HISTORY_CHANNEL,
} from "../../../shared/session/channels.js";
import { createDesktopSessionApi } from "../session.js";
import type { SessionIpcRenderer } from "../session.js";

const snapshot = {
  sessionId: "session-1",
  eventSequence: 2,
  surfaceGeneration: 0,
  measuredAt: "2026-10-18T00:00:00.000Z",
  measurement: { usedTokens: 10, estimatedRequestTokens: 12, basis: "estimate" },
  budget: { kind: "disabled", reason: "missing-capacity" },
} as const;

const history = {
  sessionId: "session-1",
  surfaceGeneration: 0,
  entries: [],
  nextCursor: null,
} as const;

describe("createDesktopSessionApi", () => {
  it("invokes the shared channels and validates results", async () => {
    const ipc = new FakeIpc();
    ipc.responses.set(SESSION_CONTEXT_GET_CHANNEL, { type: "ok", value: snapshot });
    ipc.responses.set(SESSION_CONTEXT_HISTORY_CHANNEL, { type: "ok", value: history });
    ipc.responses.set(SESSION_CONTEXT_FOLLOW_START_CHANNEL, {
      type: "ok", value: { subscriptionId: "sub-1" },
    });
    ipc.responses.set(SESSION_CONTEXT_FOLLOW_CANCEL_CHANNEL, { type: "ok", value: null });
    const api = createDesktopSessionApi(ipc);

    expect(await api.getContext({ sessionId: "session-1" }))
      .toEqual({ type: "ok", value: snapshot });
    expect(await api.getHistory({ sessionId: "session-1", limit: 5 }))
      .toEqual({ type: "ok", value: history });
    expect(await api.startContextFollow({ sessionId: "session-1" }))
      .toEqual({ type: "ok", value: { subscriptionId: "sub-1" } });
    expect(await api.cancelContextFollow("sub-1"))
      .toEqual({ type: "ok", value: null });
    expect(ipc.invocations).toEqual([
      [SESSION_CONTEXT_GET_CHANNEL, { sessionId: "session-1" }],
      [SESSION_CONTEXT_HISTORY_CHANNEL, { sessionId: "session-1", limit: 5 }],
      [SESSION_CONTEXT_FOLLOW_START_CHANNEL, { sessionId: "session-1" }],
      [SESSION_CONTEXT_FOLLOW_CANCEL_CHANNEL, "sub-1"],
    ]);
  });

  it("rejects malformed outputs and closed bridges", async () => {
    const ipc = new FakeIpc();
    ipc.responses.set(SESSION_CONTEXT_GET_CHANNEL, { type: "ok", value: { sessionId: "s" } });
    const api = createDesktopSessionApi(ipc);
    expect(await api.getContext({ sessionId: "s" }))
      .toMatchObject({ type: "failed", failure: { code: "invalid-output" } });

    ipc.fail = true;
    expect(await api.getHistory({ sessionId: "s", limit: 1 }))
      .toMatchObject({ type: "failed", failure: { code: "bridge-closed" } });
  });

  it("parses follow events and removes its listener", () => {
    const ipc = new FakeIpc();
    let invalid = 0;
    const api = createDesktopSessionApi(ipc, () => { invalid += 1; });
    const received: DesktopSessionEvent[] = [];
    const unsubscribe = api.onContextEvent(event => received.push(event));

    ipc.emit(SESSION_CONTEXT_EVENT_CHANNEL, {
      type: "context-event",
      subscriptionId: "sub-1",
      event: { type: "snapshot", snapshot },
    });
    ipc.emit(SESSION_CONTEXT_EVENT_CHANNEL, { type: "context-event", subscriptionId: "sub-1" });
    expect(received).toHaveLength(1);
    expect(received[0]).toMatchObject({ type: "context-event", subscriptionId: "sub-1" });
    expect(invalid).toBe(1);

    unsubscribe();
    ipc.emit(SESSION_CONTEXT_EVENT_CHANNEL, {
      type: "context-event",
      subscriptionId: "sub-1",
      event: { type: "snapshot", snapshot },
    });
    expect(received).toHaveLength(1);
    expect(ipc.listeners.get(SESSION_CONTEXT_EVENT_CHANNEL)?.size ?? 0).toBe(0);
  });
});

class FakeIpc implements SessionIpcRenderer {
  readonly invocations: Array<[string, unknown]> = [];
  readonly responses = new Map<string, unknown>();
  readonly listeners = new Map<string, Set<(event: unknown, value: unknown) => void>>();
  fail = false;

  async invoke(channel: string, value: unknown): Promise<unknown> {
    this.invocations.push([channel, value]);
    if (this.fail) throw new Error("ipc closed");
    return this.responses.get(channel);
  }

  on(channel: string, listener: (event: unknown, value: unknown) => void): void {
    const listeners = this.listeners.get(channel) ?? new Set();
    listeners.add(listener);
    this.listeners.set(channel, listeners);
  }

  removeListener(channel: string, listener: (event: unknown, value: unknown) => void): void {
    this.listeners.get(channel)?.delete(listener);
  }

  emit(channel: string, value: unknown): void {
    for (const listener of this.listeners.get(channel) ?? []) listener({}, value);
  }
}
