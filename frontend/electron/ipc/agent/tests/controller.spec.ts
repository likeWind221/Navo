import { describe, expect, it, vi } from "vitest";

import { RpcError } from "../../../../../rpc/index.js";
import type { AgentTurnEvent } from "../../../../../rpc/index.js";
import type { DesktopAgentTurnUpdate } from "../../../../shared/agent.js";
import type { AgentTurnHost, AgentTurnTarget } from "../controller.js";
import { AgentTurnController } from "../controller.js";

describe("AgentTurnController", () => {
  it("forwards an ordered stream and releases the active turn", async () => {
    const host = scriptedHost([
      { type: "started", turnId: "turn-1" },
      { type: "text-delta", text: "回答" },
      { type: "completed" },
    ]);
    const target = createTarget(1);
    const controller = new AgentTurnController(host);

    controller.start(target, input("request-1"));
    await vi.waitFor(() => expect(target.updates).toHaveLength(3));
    controller.start(target, input("request-2"));
    await vi.waitFor(() => expect(target.updates).toHaveLength(6));
  });

  it("allows only the owning Renderer to cancel the active turn", async () => {
    const host: AgentTurnHost = {
      async *stream(_method, _input, options) {
        yield { type: "started", turnId: "turn-1" } as never;
        await waitForAbort(options?.signal);
      },
    };
    const target = createTarget(7);
    const controller = new AgentTurnController(host);
    controller.start(target, input("request-1"));
    await vi.waitFor(() => expect(target.updates).toHaveLength(1));

    controller.cancel(8, "request-1");
    expect(target.updates).toHaveLength(1);
    controller.cancel(7, "request-1");
    await vi.waitFor(() => expect(target.updates.at(-1)).toEqual({
      type: "event",
      requestId: "request-1",
      event: { type: "cancelled" },
    }));
  });

  it("sanitizes unknown Host failures and drops updates for destroyed targets", async () => {
    const host: AgentTurnHost = {
      async *stream() {
        throw new Error("secret local path D:/private");
      },
    };
    const target = createTarget(1);
    const controller = new AgentTurnController(host);
    controller.start(target, input("request-1"));
    await vi.waitFor(() => expect(target.updates.at(-1)).toEqual({
      type: "bridge-error",
      requestId: "request-1",
      failure: { code: "host-unavailable", message: "Agent 服务暂不可用，请稍后重试" },
    }));

    target.destroyed = true;
    controller.start(target, input("request-2"));
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(target.updates).toHaveLength(1);
  });

  it("keeps the first business terminal when transport closure follows it", async () => {
    const host: AgentTurnHost = {
      async *stream() {
        yield { type: "started", turnId: "turn-1" } as never;
        yield { type: "completed" } as never;
        throw new RpcError("connection-closed", "closed before RPC end");
      },
    };
    const target = createTarget(1);
    new AgentTurnController(host).start(target, input("request-1"));

    await vi.waitFor(() => expect(target.updates).toHaveLength(2));
    expect(target.updates.at(-1)).toEqual({
      type: "event",
      requestId: "request-1",
      event: { type: "completed" },
    });
  });

  it("returns a distinct rejection while another turn remains active", async () => {
    const host: AgentTurnHost = {
      async *stream(_method, _input, options) {
        yield { type: "started", turnId: "turn-1" } as never;
        await waitForAbort(options?.signal);
      },
    };
    const controller = new AgentTurnController(host);
    const target = createTarget(1);
    controller.start(target, input("request-1"));

    expect(controller.start(target, input("request-2"))).toEqual({
      code: "turn-in-progress",
      message: "Agent 正在生成，请等待完成或点击停止",
    });
    controller.dispose();
    await vi.waitFor(() => expect(target.updates.at(-1)).toMatchObject({ event: { type: "cancelled" } }));
  });

  it("maps a hanging turn to timeout instead of cancelled", async () => {
    const host: AgentTurnHost = {
      async *stream(_method, _input, options) {
        yield { type: "started", turnId: "turn-1" } as never;
        await waitForAbort(options?.signal);
      },
    };
    const target = createTarget(1);
    const controller = new AgentTurnController(host, 10);

    expect(controller.start(target, input("request-1"))).toBeNull();
    await vi.waitFor(() => expect(target.updates.at(-1)).toEqual({
      type: "bridge-error",
      requestId: "request-1",
      failure: { code: "turn-timeout", message: "Agent 响应超时，请重试" },
    }));
  });

  it("returns a bridge-closed rejection after disposal", () => {
    const controller = new AgentTurnController(scriptedHost([]));
    controller.dispose();

    expect(controller.start(createTarget(1), input("request-1"))).toEqual({
      code: "bridge-closed",
      message: "Agent 桥接已关闭，请重启窗口",
    });
  });

  it("cancels the active turn when its owning window closes", async () => {
    const host: AgentTurnHost = {
      async *stream(_method, _input, options) {
        yield { type: "started", turnId: "turn-1" } as never;
        await waitForAbort(options?.signal);
      },
    };
    const target = createTarget(3);
    const controller = new AgentTurnController(host);
    controller.start(target, input("request-1"));
    await vi.waitFor(() => expect(target.updates).toHaveLength(1));

    controller.cancelOwner(3);
    await vi.waitFor(() => expect(target.updates.at(-1)).toMatchObject({ event: { type: "cancelled" } }));
  });
});

function input(requestId: string) {
  return { sessionId: "session-1", requestId, text: "你好" };
}

function scriptedHost(events: readonly AgentTurnEvent[]): AgentTurnHost {
  return {
    async *stream() {
      for (const event of events) yield event as never;
    },
  };
}

function createTarget(ownerId: number): AgentTurnTarget & {
  destroyed: boolean;
  updates: DesktopAgentTurnUpdate[];
} {
  const target = {
    ownerId,
    destroyed: false,
    updates: [] as DesktopAgentTurnUpdate[],
    isDestroyed: () => target.destroyed,
    send: (update: DesktopAgentTurnUpdate) => target.updates.push(update),
  };
  return target;
}

function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  if (signal?.aborted === true) return Promise.reject(new RpcError("cancelled", "cancelled"));
  return new Promise((_, reject) => {
    signal?.addEventListener("abort", () => reject(new RpcError("cancelled", "cancelled")), { once: true });
  });
}
