import { describe, expect, it, vi } from "vitest";

import type { AgentIpcRenderer } from "../agent.js";
import { createDesktopAgentApi } from "../agent.js";
import { DesktopAgentCommandError } from "../../../shared/agent/errors.js";
import {
  AGENT_COMMAND_CANCEL_CHANNEL,
  AGENT_COMMAND_START_CHANNEL,
  AGENT_TURN_CANCEL_CHANNEL,
  AGENT_TURN_START_CHANNEL,
  AGENT_TURN_UPDATE_CHANNEL,
} from "../../../shared/agent/channels.js";

describe("createDesktopAgentApi", () => {
  it("uses only fixed start and cancel channels", async () => {
    const ipc = new FakeIpcRenderer();
    const api = createDesktopAgentApi(ipc);
    await api.startTurn({ sessionId: "session-1", requestId: "request-1", text: "你好" });
    await api.cancelTurn("request-1");

    expect(ipc.invocations).toEqual([
      [AGENT_TURN_START_CHANNEL, { sessionId: "session-1", requestId: "request-1", text: "你好" }],
      [AGENT_TURN_CANCEL_CHANNEL, "request-1"],
    ]);
  });

  it("validates updates and cleanup removes the exact listener", () => {
    const ipc = new FakeIpcRenderer();
    const invalid = vi.fn();
    const listener = vi.fn();
    const cleanup = createDesktopAgentApi(ipc, invalid).onTurnUpdate(listener);

    ipc.emit({ type: "event", requestId: "request-1", event: { type: "completed" } });
    ipc.emit({ type: "event", requestId: "request-1", event: { type: "unknown" } });
    cleanup();

    expect(listener).toHaveBeenCalledOnce();
    expect(invalid).toHaveBeenCalledOnce();
    expect(ipc.listener).toBeUndefined();
  });

  it("turns a rejected start result into a typed command error", async () => {
    const ipc = new FakeIpcRenderer({
      type: "rejected",
      failure: { code: "turn-in-progress", message: "Agent 正在生成" },
    });

    await expect(createDesktopAgentApi(ipc).startTurn({
      sessionId: "session-1", requestId: "request-1", text: "你好",
    })).rejects.toMatchObject({
      name: "DesktopAgentCommandError",
      failure: { code: "turn-in-progress", message: "Agent 正在生成" },
    } satisfies Partial<DesktopAgentCommandError>);
  });

  it("uses command channels and parses unified events", async () => {
    const ipc = new FakeIpcRenderer();
    const api = createDesktopAgentApi(ipc);
    const listener = vi.fn();
    const cleanup = api.onEvent(listener);

    await api.startCommand({
      sessionId: "session-1", commandId: "command-1", name: "hello", args: "",
    });
    await api.cancelCommand("command-1");
    ipc.emit({
      type: "command-event",
      event: {
        type: "command-completed", sessionId: "session-1", commandId: "command-1", name: "hello",
        anchor: { kind: "session" }, summary: "hello",
      },
    });
    cleanup();

    expect(ipc.invocations).toEqual([
      [AGENT_COMMAND_START_CHANNEL, {
        sessionId: "session-1", commandId: "command-1", name: "hello", args: "",
      }],
      [AGENT_COMMAND_CANCEL_CHANNEL, "command-1"],
    ]);
    expect(listener).toHaveBeenCalledWith(expect.objectContaining({ type: "command-event" }));
  });
});

class FakeIpcRenderer implements AgentIpcRenderer {
  readonly invocations: Array<[string, unknown]> = [];
  listener: ((event: unknown, value: unknown) => void) | undefined;

  constructor(private readonly result: unknown = { type: "accepted" }) {}

  invoke(channel: string, value: unknown): Promise<unknown> {
    this.invocations.push([channel, value]);
    return Promise.resolve(this.result);
  }

  on(channel: string, listener: (event: unknown, value: unknown) => void): void {
    expect(channel).toBe(AGENT_TURN_UPDATE_CHANNEL);
    this.listener = listener;
  }

  removeListener(channel: string, listener: (event: unknown, value: unknown) => void): void {
    expect(channel).toBe(AGENT_TURN_UPDATE_CHANNEL);
    if (this.listener === listener) this.listener = undefined;
  }

  emit(value: unknown): void {
    this.listener?.({}, value);
  }
}
