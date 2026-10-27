import { describe, expect, it } from "vitest";
import type { ProjectDetailV1, ProjectFollowV1 } from "../../../../rpc/project.js";
import type { RpcMethod } from "../../../../rpc/index.js";
import type { DesktopProjectEvent } from "../../../shared/project.js";
import { ProjectController } from "./controller.js";
import type { ProjectHost } from "./handler.js";

const detail: ProjectDetailV1 = {
  project: { projectId: "p-1", name: "项目", goal: "目标", workspaceRoot: null, status: "active", revision: 1, createdAt: "2026-10-26T00:00:00.000Z" },
  main: { sessionId: "session-1", turnActive: false }, roadmap: null,
};

describe("ProjectController", () => {
  it("emits a dedicated cancellation failure when stopped before turn-started", () => {
    const host = new QueuedHost();
    const target = new Target();
    const controller = new ProjectController(host);
    const result = controller.startTurn(target, { projectId: "p-1", requestId: "request-1", text: "你好", target: { kind: "main" } });
    expect(result.type).toBe("ok");
    if (result.type === "ok") controller.cancel(target.ownerId, result.value.subscriptionId);
    expect(target.events).toHaveLength(1);
    expect(target.events[0]).toMatchObject({ type: "turn-error", failure: { code: "cancelled" } });
    controller.dispose();
  });

  it("carries the real session and request ids into a post-start cancellation event", async () => {
    const host = new SequenceHost([{ type: "turn-started", sessionId: "real-session", requestId: "request-2", turnId: "turn-2" }], true);
    const target = new Target();
    const controller = new ProjectController(host);
    const result = controller.startTurn(target, { projectId: "p-1", requestId: "request-2", text: "停止", target: { kind: "main" } });
    expect(result.type).toBe("ok");
    await waitFor(() => target.events.length > 0);
    if (result.type === "ok") controller.cancel(target.ownerId, result.value.subscriptionId);
    host.release();
    expect(target.events).toEqual([
      { type: "turn-event", operationId: target.operationId, projectId: "p-1", event: { type: "turn-started", sessionId: "real-session", requestId: "request-2", turnId: "turn-2" } },
      { type: "turn-event", operationId: target.operationId, projectId: "p-1", event: { type: "turn-cancelled", sessionId: "real-session", requestId: "request-2", turnId: "turn-2" } },
    ]);
    controller.dispose();
  });

  it("turns a stream that ends without a terminal event into invalid-output", async () => {
    const host = new SequenceHost([{ type: "turn-started", sessionId: "s", requestId: "request-3", turnId: "t" }]);
    const target = new Target();
    const controller = new ProjectController(host);
    controller.startTurn(target, { projectId: "p-1", requestId: "request-3", text: "断流", target: { kind: "main" } });
    await waitFor(() => target.events.length > 1);
    expect(target.events.at(-1)).toMatchObject({ type: "turn-error", failure: { code: "invalid-output" } });
    controller.dispose();
  });

  it("rejects follow output that crosses its requested project scope", async () => {
    const wrong = { ...follow("p-1"), detail: { ...detail, project: { ...detail.project, projectId: "p-2" } } };
    const host = new SequenceHost([wrong]);
    const target = new Target();
    const controller = new ProjectController(host);
    controller.startFollow(target, { projectId: "p-1" });
    await waitFor(() => target.events.length > 0);
    expect(target.events.at(-1)).toMatchObject({ type: "follow-error", failure: { code: "invalid-output" } });
    controller.dispose();
  });
});

function follow(projectId: string): ProjectFollowV1 {
  return { detail: { ...detail, project: { ...detail.project, projectId } }, mailboxSequence: 1, resourceRevision: 1 };
}

class Target {
  readonly ownerId = 42;
  readonly events: DesktopProjectEvent[] = [];
  operationId = "";
  isDestroyed(): boolean { return false; }
  send(event: DesktopProjectEvent): void { this.operationId ||= event.operationId; this.events.push(event); }
}

class SequenceHost implements ProjectHost {
  private readonly releasePromise: Promise<void>;
  private releaseValue: (() => void) | null = null;
  constructor(private readonly values: readonly unknown[], private readonly hold = false) {
    this.releasePromise = new Promise(resolve => { this.releaseValue = resolve; });
  }
  stream<TInput, TOutput>(method: RpcMethod<TInput, TOutput>, input: TInput, options?: import("../../../../rpc/index.js").RpcStreamOptions): AsyncIterable<TOutput> {
    const hold = this.hold;
    const release = this.releasePromise;
    const validator = method.createOutputValidator?.(input);
    const signal = options?.signal;
    return (async function* (values: readonly unknown[]) {
      try {
        for (const value of values) yield validator === undefined ? method.parseOutput(value) : validator.parse(value);
        if (hold) await release;
      } finally {
        if (!signal?.aborted) validator?.end();
      }
    })(this.values) as AsyncIterable<TOutput>;
  }
  release(): void { this.releaseValue?.(); }
}

class QueuedHost implements ProjectHost {
  stream<TInput, TOutput>(method: RpcMethod<TInput, TOutput>, input: TInput, options?: import("../../../../rpc/index.js").RpcStreamOptions): AsyncIterable<TOutput> {
    const validator = method.createOutputValidator?.(input);
    return (async function* () {
      try { await new Promise<void>(resolve => options?.signal?.addEventListener("abort", () => resolve(), { once: true })); }
      finally { if (!options?.signal?.aborted) validator?.end(); }
    })() as AsyncIterable<TOutput>;
  }
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let index = 0; index < 20; index += 1) {
    if (predicate()) return;
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  throw new Error("Timed out waiting for controller event");
}
