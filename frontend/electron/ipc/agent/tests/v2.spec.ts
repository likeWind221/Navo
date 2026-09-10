import { describe, expect, it, vi } from "vitest";

import { RpcError } from "../../../../../rpc/index.js";
import type { DesktopAgentEvent } from "../../../../shared/agent.js";
import type { AgentTurnV2Host, AgentTurnV2Target } from "../v2.js";
import { AgentTurnV2Controller } from "../v2.js";

describe("AgentTurnV2Controller", () => {
  it("forwards ordered v2 events and releases the turn", async () => {
    const host = scriptedHost([
      { type: "turn-started", sessionId: "session-1", requestId: "request-1", turnId: "turn-1" },
      { type: "turn-completed", sessionId: "session-1", requestId: "request-1", turnId: "turn-1" },
    ]);
    const target = createTarget(1);
    const controller = new AgentTurnV2Controller(host);

    expect(controller.start(target, input("request-1"))).toBeNull();
    await vi.waitFor(() => expect(target.updates).toHaveLength(2));
    expect(target.updates).toEqual([
      { type: "turn-event", event: expect.objectContaining({ type: "turn-started" }) },
      { type: "turn-event", event: expect.objectContaining({ type: "turn-completed" }) },
    ]);
    expect(controller.start(target, input("request-2"))).toBeNull();
  });

  it("maps cancellation to a scoped v2 terminal event", async () => {
    const host: AgentTurnV2Host = {
      async *stream(_method, _input, options) {
        yield { type: "turn-started", sessionId: "session-1", requestId: "request-1", turnId: "turn-1" } as never;
        await waitForAbort(options?.signal);
      },
    };
    const target = createTarget(1);
    const controller = new AgentTurnV2Controller(host);
    controller.start(target, input("request-1"));
    await vi.waitFor(() => expect(target.updates).toHaveLength(1));

    controller.cancel(1, "request-1");
    await vi.waitFor(() => expect(target.updates.at(-1)).toEqual({
      type: "turn-event",
      event: {
        type: "turn-cancelled", sessionId: "session-1", requestId: "request-1", turnId: "turn-1",
      },
    }));
  });
});

function input(requestId: string) {
  return { sessionId: "session-1", requestId, text: "hello" };
}

function scriptedHost(events: readonly unknown[]): AgentTurnV2Host {
  return {
    async *stream() {
      for (const event of events) yield event as never;
    },
  };
}

function createTarget(ownerId: number): AgentTurnV2Target & { updates: DesktopAgentEvent[] } {
  const target = {
    ownerId,
    updates: [] as DesktopAgentEvent[],
    isDestroyed: () => false,
    send: (update: DesktopAgentEvent) => target.updates.push(update),
  };
  return target;
}

function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  if (signal?.aborted === true) return Promise.reject(new RpcError("cancelled", "cancelled"));
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(new RpcError("cancelled", "cancelled")), { once: true });
  });
}
