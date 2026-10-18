import { describe, expect, it, vi } from "vitest";

import { RpcError } from "../../../../../rpc/errors.js";
import type { RpcMethod, RpcStreamOptions } from "../../../../../rpc/index.js";
import type { DesktopSessionEvent } from "../../../../shared/session.js";
import {
  SessionContextController,
} from "../../session-context.js";
import type { SessionContextHost, SessionContextTarget } from "../../session-context.js";

const snapshot = {
  sessionId: "session-1",
  eventSequence: 2,
  surfaceGeneration: 0,
  measuredAt: "2026-10-18T00:00:00.000Z",
  measurement: { usedTokens: 10, estimatedRequestTokens: 12, basis: "estimate" },
  budget: {
    kind: "enabled", contextWindow: 1_000, reservedOutputTokens: 100,
    thresholdTokens: 800, retainTokens: 50, exceeded: false,
  },
} as const;

const history = {
  sessionId: "session-1",
  surfaceGeneration: 0,
  entries: [{
    kind: "message", sequence: 1, timestamp: "2026-10-18T00:00:00.000Z",
    message: { id: "m1", role: "user", content: [{ type: "text", text: "hello" }] },
  }],
  nextCursor: null,
} as const;

describe("SessionContextController unary requests", () => {
  it("validates input, forwards it, and returns one output", async () => {
    const host = new FakeHost();
    host.outputs.set("session.context.v1", async function* () { yield snapshot; });
    host.outputs.set("session.history.v1", async function* () { yield history; });
    const controller = new SessionContextController(host);

    expect(await controller.getContext({ sessionId: "session-1" }))
      .toEqual({ type: "ok", value: snapshot });
    expect(await controller.getHistory({ sessionId: "session-1", limit: 5 }))
      .toEqual({ type: "ok", value: history });
    expect(host.calls).toEqual([
      { method: "session.context.v1", input: { sessionId: "session-1" } },
      { method: "session.history.v1", input: { sessionId: "session-1", limit: 5 } },
    ]);
  });

  it("rejects invalid input before calling the Host", async () => {
    const host = new FakeHost();
    const controller = new SessionContextController(host);

    expect(await controller.getContext({ sessionId: "" }))
      .toMatchObject({ type: "failed", failure: { code: "invalid-input" } });
    expect(await controller.getHistory({ sessionId: "s", limit: 51 }))
      .toMatchObject({ type: "failed", failure: { code: "invalid-input" } });
    expect(host.calls).toEqual([]);
  });

  it("maps remote, transport and malformed outputs to stable failures", async () => {
    const host = new FakeHost();
    host.outputs.set("session.context.v1", async function* () {
      throw new RpcError("remote-error", "changed", {
        failure: { code: "history-changed", message: "changed", details: { surfaceGeneration: 2 } },
      });
    });
    const controller = new SessionContextController(host);
    expect(await controller.getContext({ sessionId: "s" }))
      .toMatchObject({
        type: "failed",
        failure: { code: "history-changed", details: { surfaceGeneration: 2 } },
      });

    host.outputs.set("session.context.v1", async function* () {
      throw new RpcError("connection-closed", "closed");
    });
    expect(await controller.getContext({ sessionId: "s" }))
      .toMatchObject({ type: "failed", failure: { code: "host-unavailable" } });

    host.outputs.set("session.context.v1", async function* () {
      yield { ...snapshot, budget: { kind: "disabled", reason: "other" } };
    });
    expect(await controller.getContext({ sessionId: "s" }))
      .toMatchObject({ type: "failed", failure: { code: "invalid-output" } });

    host.outputs.set("session.context.v1", async function* () {});
    expect(await controller.getContext({ sessionId: "s" }))
      .toMatchObject({ type: "failed", failure: { code: "invalid-output" } });
  });
});

describe("SessionContextController follow subscriptions", () => {
  it("publishes events with a subscription identity and cancels by owner", async () => {
    const host = new FakeHost();
    host.outputs.set("session.context.follow.v1", signal => snapshotThenWait(signal));
    const controller = new SessionContextController(host);
    const target = new FakeTarget(7);

    const started = controller.startContextFollow(target, { sessionId: "session-1" });
    expect(started).toMatchObject({ type: "ok" });
    if (started.type !== "ok") return;
    await vi.waitFor(() => expect(target.updates).toHaveLength(1));
    expect(target.updates[0]).toEqual({
      type: "context-event",
      subscriptionId: started.value.subscriptionId,
      event: { type: "snapshot", snapshot },
    });

    controller.cancelContextFollow(8, started.value.subscriptionId);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(target.updates).toHaveLength(1);

    controller.cancelContextFollow(7, started.value.subscriptionId);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(target.updates).toHaveLength(1);
  });

  it("isolates owners and cleans up a destroyed window", async () => {
    const host = new FakeHost();
    host.outputs.set("session.context.follow.v1", signal => snapshotThenWait(signal));
    const controller = new SessionContextController(host);
    const first = new FakeTarget(1);
    const second = new FakeTarget(2);
    controller.startContextFollow(first, { sessionId: "session-1" });
    controller.startContextFollow(second, { sessionId: "session-1" });
    await vi.waitFor(() => expect(first.updates).toHaveLength(1));
    await vi.waitFor(() => expect(second.updates).toHaveLength(1));

    controller.cancelOwner(1);
    await new Promise(resolve => setTimeout(resolve, 10));
    second.isDestroyedValue = true;
    controller.cancelOwner(2);
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(first.updates).toHaveLength(1);
    expect(second.updates).toHaveLength(1);
  });

  it("reports malformed frames and Session leaks as invalid-output", async () => {
    const host = new FakeHost();
    host.outputs.set("session.context.follow.v1", async function* () {
      yield { type: "snapshot", snapshot: { ...snapshot, sessionId: "session-2" } };
    });
    const controller = new SessionContextController(host);
    const target = new FakeTarget(1);
    const started = controller.startContextFollow(target, { sessionId: "session-1" });
    expect(started.type).toBe("ok");
    await vi.waitFor(() => expect(target.updates).toHaveLength(1));
    expect(target.updates[0]).toMatchObject({
      type: "context-follow-error",
      failure: { code: "invalid-output" },
    });

    host.outputs.set("session.context.follow.v1", async function* () {
      yield { type: "snapshot" };
    });
    const malformed = new FakeTarget(1);
    controller.startContextFollow(malformed, { sessionId: "session-1" });
    await vi.waitFor(() => expect(malformed.updates).toHaveLength(1));
    expect(malformed.updates[0]).toMatchObject({
      type: "context-follow-error",
      failure: { code: "invalid-output" },
    });

    host.outputs.set("session.context.follow.v1", async function* () {
      yield { type: "context-updated", snapshot };
    });
    const noBaseline = new FakeTarget(1);
    controller.startContextFollow(noBaseline, { sessionId: "session-1" });
    await vi.waitFor(() => expect(noBaseline.updates).toHaveLength(1));
    expect(noBaseline.updates[0]).toMatchObject({
      type: "context-follow-error",
      failure: { code: "invalid-output" },
    });
  });

  it("reports an unexpected Host end and closes cleanly on dispose", async () => {
    const host = new FakeHost();
    host.outputs.set("session.context.follow.v1", async function* () { yield { type: "snapshot", snapshot }; });
    const controller = new SessionContextController(host);
    const ended = new FakeTarget(1);
    controller.startContextFollow(ended, { sessionId: "session-1" });
    await vi.waitFor(() => expect(ended.updates).toHaveLength(2));
    expect(ended.updates[1]).toMatchObject({
      type: "context-follow-error",
      failure: { code: "host-unavailable" },
    });

    host.outputs.set("session.context.follow.v1", signal => snapshotThenWait(signal));
    const disposed = new FakeTarget(2);
    controller.startContextFollow(disposed, { sessionId: "session-1" });
    await vi.waitFor(() => expect(disposed.updates).toHaveLength(1));
    controller.dispose();
    await new Promise(resolve => setTimeout(resolve, 10));
    expect(disposed.updates).toHaveLength(1);
    expect(controller.startContextFollow(disposed, { sessionId: "session-1" }))
      .toMatchObject({ type: "failed", failure: { code: "bridge-closed" } });
  });

  it("rejects malformed subscription identities and unknown candidates", () => {
    const controller = new SessionContextController(new FakeHost());
    expect(controller.cancelContextFollow(1, ""))
      .toMatchObject({ type: "failed", failure: { code: "invalid-input" } });
    expect(controller.startContextFollow(new FakeTarget(1), { sessionId: "" }))
      .toMatchObject({ type: "failed", failure: { code: "invalid-input" } });
  });
});

function snapshotThenWait(
  signal: AbortSignal | undefined,
): AsyncIterable<unknown> {
  return (async function* () {
    yield { type: "snapshot", snapshot };
    await new Promise<void>(resolve => {
      if (signal?.aborted === true) resolve();
      else signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  })();
}

class FakeHost implements SessionContextHost {
  readonly calls: Array<{ method: string; input: unknown }> = [];
  readonly outputs = new Map<string, (signal: AbortSignal | undefined) => AsyncIterable<unknown>>();

  stream<TInput, TOutput>(
    method: RpcMethod<TInput, TOutput>,
    input: TInput,
    options?: RpcStreamOptions,
  ): AsyncIterable<TOutput> {
    this.calls.push({ method: method.name, input });
    const output = this.outputs.get(method.name);
    return output === undefined
      ? (async function* () {})()
      : output(options?.signal) as AsyncIterable<TOutput>;
  }
}

class FakeTarget implements SessionContextTarget {
  readonly updates: DesktopSessionEvent[] = [];
  isDestroyedValue = false;

  constructor(readonly ownerId: number) {}

  isDestroyed(): boolean {
    return this.isDestroyedValue;
  }

  send(update: DesktopSessionEvent): void {
    this.updates.push(update);
  }
}
