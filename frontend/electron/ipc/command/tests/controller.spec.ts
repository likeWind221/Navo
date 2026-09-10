import { describe, expect, it, vi } from "vitest";

import type { CommandEvent } from "../../../../../shared/content.js";
import type { DesktopAgentEvent } from "../../../../shared/agent.js";
import type { AgentCommandHost, AgentCommandTarget } from "../controller.js";
import { AgentCommandController } from "../controller.js";

describe("AgentCommandController", () => {
  it("forwards command events and releases the command", async () => {
    const host = scriptedHost([
      {
        type: "command-started", sessionId: "session-1", commandId: "command-1", name: "hello",
        anchor: { kind: "session" },
      },
      {
        type: "command-completed", sessionId: "session-1", commandId: "command-1", name: "hello",
        anchor: { kind: "session" }, summary: "hello",
      },
    ]);
    const target = createTarget(1);
    const controller = new AgentCommandController(host);

    expect(controller.start(target, input("command-1"))).toBeNull();
    await vi.waitFor(() => expect(target.updates).toHaveLength(2));
    expect(target.updates).toEqual([
      { type: "command-event", event: expect.objectContaining({ type: "command-started" }) },
      { type: "command-event", event: expect.objectContaining({ type: "command-completed" }) },
    ]);
    expect(controller.start(target, input("command-1"))).toBeNull();
  });
});

function input(commandId: string) {
  return { sessionId: "session-1", commandId, name: "hello", args: "" };
}

function scriptedHost(events: readonly CommandEvent[]): AgentCommandHost {
  return {
    async *stream() {
      for (const event of events) yield event as never;
    },
  };
}

function createTarget(ownerId: number): AgentCommandTarget & { updates: DesktopAgentEvent[] } {
  const target = {
    ownerId,
    updates: [] as DesktopAgentEvent[],
    isDestroyed: () => false,
    send: (update: DesktopAgentEvent) => target.updates.push(update),
  };
  return target;
}
