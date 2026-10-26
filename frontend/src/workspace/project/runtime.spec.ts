import { describe, expect, it } from "vitest";
import type { AgentTurnV2Event } from "../../../../rpc/content.js";
import type { ProjectDetailV1 } from "../../../../rpc/project.js";
import type { DesktopProjectApi, DesktopProjectEvent, DesktopProjectResult } from "../../../shared/project.js";
import { ProjectRuntime } from "./runtime.js";

const detail: ProjectDetailV1 = {
  project: { projectId: "p-1", name: "项目", goal: "目标", workspaceRoot: null, status: "active", revision: 1, createdAt: "2026-10-26T00:00:00.000Z" },
  main: { sessionId: "session-1", turnActive: false }, roadmap: null,
};
const detailTwo: ProjectDetailV1 = { ...detail, project: { ...detail.project, projectId: "p-2", name: "另一个项目" } };

describe("ProjectRuntime", () => {
  it("routes a turn event received before the start acknowledgement by request id", async () => {
    const api = new FakeProjectApi();
    const runtime = new ProjectRuntime(api);
    const stop = runtime.subscribe("p-1", detail, () => undefined);
    runtime.setDraft("p-1", detail, "先复述目标");
    expect(runtime.send("p-1", detail)).toBe(true);
    const requestId = api.turnInputs[0]?.requestId;
    expect(requestId).toBeDefined();
    api.emit({ type: "turn-event", projectId: "p-1", operationId: "turn-1", event: started(requestId!) });
    expect(runtime.snapshot("p-1", detail).conversation.activeTurn?.turnId).toBe("turn-1");
    api.resolveTurn({ type: "ok", value: { subscriptionId: "turn-1" } });
    api.emit({ type: "turn-event", projectId: "p-1", operationId: "turn-1", event: completed(requestId!) });
    expect(runtime.snapshot("p-1", detail).busy).toBe(false);
    stop(); runtime.dispose();
  });

  it("reserves the request synchronously and refuses a duplicate send", () => {
    const api = new FakeProjectApi();
    const runtime = new ProjectRuntime(api);
    runtime.subscribe("p-1", detail, () => undefined);
    runtime.setDraft("p-1", detail, "第一条");
    expect(runtime.send("p-1", detail)).toBe(true);
    runtime.setDraft("p-1", detail, "第二条");
    expect(runtime.send("p-1", detail)).toBe(false);
    expect(runtime.snapshot("p-1", detail).draft).toBe("第二条");
    runtime.dispose();
  });

  it("cancels after a late start acknowledgement and renders cancellation as a terminal state", async () => {
    const api = new FakeProjectApi();
    const runtime = new ProjectRuntime(api);
    runtime.subscribe("p-1", detail, () => undefined);
    runtime.setDraft("p-1", detail, "停止这条");
    runtime.send("p-1", detail);
    const requestId = api.turnInputs[0]?.requestId ?? "request";
    expect(runtime.cancel("p-1", detail)).toBe(true);
    api.resolveTurn({ type: "ok", value: { subscriptionId: "turn-2" } });
    await Promise.resolve();
    expect(api.cancelled).toContain("turn-2");
    api.emit({ type: "turn-error", projectId: "p-1", operationId: "turn-2", failure: { code: "cancelled", message: "已停止" } });
    expect(runtime.snapshot("p-1", detail).conversation.messages.at(-1)).toMatchObject({ status: "cancelled" });
    expect(requestId).toBeTruthy();
    runtime.dispose();
  });

  it("keeps an in-flight turn across close and reopen while stopping only follow", async () => {
    const api = new FakeProjectApi();
    const runtime = new ProjectRuntime(api);
    const stop = runtime.subscribe("p-1", detail, () => undefined);
    runtime.setDraft("p-1", detail, "保留这条草稿");
    runtime.send("p-1", detail);
    runtime.setDraft("p-1", detail, "关闭时仍保留");
    const requestId = api.turnInputs[0]?.requestId ?? "request";
    await Promise.resolve();
    stop();
    await Promise.resolve();
    expect(api.cancelled).toContain("follow-1");
    expect(api.cancelled).not.toContain("turn-1");
    api.emit({ type: "turn-event", projectId: "p-1", operationId: "turn-1", event: started(requestId) });
    const updates: unknown[] = [];
    const reopen = runtime.subscribe("p-1", detail, () => updates.push(runtime.snapshot("p-1", detail)));
    expect(runtime.snapshot("p-1", detail).conversation.messages).toHaveLength(2);
    expect(runtime.snapshot("p-1", detail).busy).toBe(true);
    expect(runtime.snapshot("p-1", detail).draft).toBe("关闭时仍保留");
    reopen(); runtime.dispose();
  });

  it("shows follow failures and ignores events from another project", () => {
    const api = new FakeProjectApi();
    const runtime = new ProjectRuntime(api);
    runtime.subscribe("p-1", detail, () => undefined);
    api.emit({ type: "follow-error", projectId: "p-1", operationId: "follow-1", failure: { code: "host-unavailable", message: "断开" } });
    expect(runtime.snapshot("p-1", detail).followFailure?.message).toBe("断开");
    runtime.setDraft("p-1", detail, "本项目");
    runtime.send("p-1", detail);
    const before = runtime.snapshot("p-1", detail).conversation;
    api.emit({ type: "turn-event", projectId: "p-2", operationId: "other", event: started("other") });
    expect(runtime.snapshot("p-1", detail).conversation).toBe(before);
    runtime.dispose();
  });

  it("allows reconnect after follow-error before acknowledgement and cancels the stale acknowledgement", async () => {
    const api = new FakeProjectApi();
    api.deferFollow = true;
    const runtime = new ProjectRuntime(api);
    runtime.subscribe("p-1", detail, () => undefined);
    api.emit({ type: "follow-error", projectId: "p-1", operationId: "follow-old", failure: { code: "host-unavailable", message: "断开" } });
    expect(runtime.snapshot("p-1", detail).followFailure?.message).toBe("断开");
    runtime.reconnect("p-1", detail);
    api.resolveFollow("follow-old");
    await Promise.resolve();
    api.resolveFollow("follow-new");
    await Promise.resolve();
    expect(api.cancelled).toContain("follow-old");
    expect(runtime.snapshot("p-1", detail).followFailure).toBeNull();
    runtime.dispose();
  });
});

function started(requestId: string): AgentTurnV2Event {
  return { type: "turn-started", sessionId: "session-1", requestId, turnId: "turn-1" };
}

function completed(requestId: string): AgentTurnV2Event {
  return { type: "turn-completed", sessionId: "session-1", requestId, turnId: "turn-1" };
}

class FakeProjectApi implements DesktopProjectApi {
  readonly turnInputs: { readonly requestId: string }[] = [];
  readonly cancelled: string[] = [];
  deferFollow = false;
  private followIndex = 0;
  private readonly followReplies: ((result: DesktopProjectResult<{ readonly subscriptionId: string }>) => void)[] = [];
  private listener: ((event: DesktopProjectEvent) => void) | null = null;
  private turnReply: ((result: DesktopProjectResult<{ readonly subscriptionId: string }>) => void) | null = null;

  list = async () => ({ type: "ok", value: { projects: [] } } as const);
  create = async () => ({ type: "failed", failure: { code: "host-unavailable" as const, message: "unused" } } as const);
  get = async () => ({ type: "ok", value: detail } as const);
  autoRunStart = async () => ({ type: "failed", failure: { code: "host-unavailable" as const, message: "unused" } } as const);
  autoRunPause = this.autoRunStart;
  autoRunResume = this.autoRunStart;
  autoRunGet = async () => ({ type: "ok", value: null } as const);
  chooseWorkspace = async () => ({ type: "ok", value: null } as const);
  startTurn = (input: { readonly requestId: string }): Promise<DesktopProjectResult<{ readonly subscriptionId: string }>> => {
    this.turnInputs.push(input);
    return new Promise(resolve => { this.turnReply = resolve; });
  };
  startFollow = (): Promise<DesktopProjectResult<{ readonly subscriptionId: string }>> => {
    const subscriptionId = this.deferFollow ? (this.followIndex++ === 0 ? "follow-old" : "follow-new") : "follow-1";
    if (!this.deferFollow) return Promise.resolve({ type: "ok", value: { subscriptionId } });
    return new Promise(resolve => this.followReplies.push(result => resolve(result)));
  };
  cancel = async (operationId: string) => { this.cancelled.push(operationId); return { type: "ok", value: null } as const; };
  onEvent = (listener: (event: DesktopProjectEvent) => void): (() => void) => { this.listener = listener; return () => { this.listener = null; }; };

  resolveTurn(result: DesktopProjectResult<{ readonly subscriptionId: string }>): void { this.turnReply?.(result); this.turnReply = null; }
  resolveFollow(subscriptionId: string): void { this.followReplies.shift()?.({ type: "ok", value: { subscriptionId } }); }
  emit(event: DesktopProjectEvent): void { this.listener?.(event); }
}
