import { describe, expect, it } from "vitest";
import type { AgentTurnV2Event } from "../../../../rpc/content.js";
import type { ProjectDetailV1, ProjectTurnInput, ProjectTurnTarget } from "../../../../rpc/project.js";
import type { DesktopProjectApi, DesktopProjectEvent, DesktopProjectResult } from "../../../shared/project.js";
import { ProjectRuntime } from "./runtime.js";

const detail: ProjectDetailV1 = {
  project: { projectId: "p-1", name: "项目", goal: "目标", workspaceRoot: null, status: "active", revision: 1, createdAt: "2026-10-26T00:00:00.000Z" },
  main: { sessionId: "session-1", turnActive: false }, roadmap: null,
};
const detailTwo: ProjectDetailV1 = { ...detail, project: { ...detail.project, projectId: "p-2", name: "另一个项目" } };
const main: ProjectTurnTarget = { kind: "main" };
const nodeA: ProjectTurnTarget = { kind: "node", nodeId: "a" };
const nodeB: ProjectTurnTarget = { kind: "node", nodeId: "b" };

describe("ProjectRuntime", () => {
  it("replaces roadmap facts from follow without starting a turn", () => {
    const api = new FakeProjectApi();
    const runtime = new ProjectRuntime(api);
    runtime.subscribe("p-1", detail, () => undefined);
    const next: ProjectDetailV1 = { ...detail, roadmap: { revision: 7, nodes: [], edges: [] } };
    api.emit({ type: "follow-snapshot", operationId: "follow-1", projectId: "p-1", snapshot: { detail: next, mailboxSequence: 0, resourceRevision: 0 } });
    expect(runtime.snapshot("p-1", detail).detail).toBe(next);
    expect(api.turnInputs).toHaveLength(0);
    api.emit({ type: "follow-snapshot", operationId: "other", projectId: "p-2", snapshot: { detail: detailTwo, mailboxSequence: 0, resourceRevision: 0 } });
    expect(runtime.snapshot("p-1", detail).detail).toBe(next);
    runtime.dispose();
  });

  it("routes a turn event received before the start acknowledgement by request id", async () => {
    const api = new FakeProjectApi();
    const runtime = new ProjectRuntime(api);
    const stop = runtime.subscribe("p-1", detail, () => undefined);
    runtime.setDraft("p-1", main, "先复述目标");
    expect(runtime.send("p-1", main)).toBe(true);
    const requestId = api.turnInputs[0]?.requestId;
    expect(requestId).toBeDefined();
    api.emit({ type: "turn-event", projectId: "p-1", operationId: "turn-1", event: started(requestId!) });
    expect(runtime.targetSnapshot("p-1", main).conversation.activeTurn?.turnId).toBe("turn-1");
    api.resolveTurn(requestId!, "turn-1");
    await Promise.resolve();
    api.emit({ type: "turn-event", projectId: "p-1", operationId: "turn-1", event: completed(requestId!) });
    expect(runtime.targetSnapshot("p-1", main).busy).toBe(false);
    stop(); runtime.dispose();
  });

  it("keeps Main and Node drafts, turns, and terminal states isolated", async () => {
    const api = new FakeProjectApi();
    const runtime = new ProjectRuntime(api);
    runtime.subscribe("p-1", detail, () => undefined);
    runtime.setDraft("p-1", main, "Main 草稿");
    runtime.setDraft("p-1", nodeA, "Node A 草稿");
    runtime.setDraft("p-1", nodeB, "Node B 草稿");
    expect(runtime.send("p-1", main)).toBe(true);
    expect(runtime.send("p-1", nodeA)).toBe(true);
    expect(api.turnInputs.map(input => input.target)).toEqual([main, nodeA]);
    expect(runtime.targetSnapshot("p-1", main).busy).toBe(true);
    expect(runtime.targetSnapshot("p-1", nodeA).busy).toBe(true);
    expect(runtime.targetSnapshot("p-1", nodeB)).toMatchObject({ draft: "Node B 草稿", busy: false });

    const nodeRequest = api.turnInputs[1]!.requestId;
    api.emit({ type: "turn-event", projectId: "p-1", operationId: "node-turn", event: started(nodeRequest, "node-turn") });
    api.emit({ type: "turn-event", projectId: "p-1", operationId: "node-turn", event: completed(nodeRequest, "node-turn") });

    expect(runtime.targetSnapshot("p-1", nodeA).conversation.messages.at(-1)).toMatchObject({ role: "assistant", status: "completed" });
    expect(runtime.targetSnapshot("p-1", nodeA).busy).toBe(false);
    expect(runtime.targetSnapshot("p-1", main).busy).toBe(true);
    expect(runtime.targetSnapshot("p-1", main).conversation.messages).toHaveLength(2);
    expect(runtime.targetSnapshot("p-1", nodeB).conversation.messages).toHaveLength(0);
    expect(runtime.targetSnapshot("p-1", nodeB).draft).toBe("Node B 草稿");
    runtime.dispose();
  });

  it("reserves a request per target and refuses only duplicate sends to the same target", () => {
    const api = new FakeProjectApi();
    const runtime = new ProjectRuntime(api);
    runtime.subscribe("p-1", detail, () => undefined);
    runtime.setDraft("p-1", nodeA, "第一节点");
    expect(runtime.send("p-1", nodeA)).toBe(true);
    runtime.setDraft("p-1", nodeA, "重复发送");
    expect(runtime.send("p-1", nodeA)).toBe(false);
    expect(runtime.targetSnapshot("p-1", nodeA).draft).toBe("重复发送");
    runtime.setDraft("p-1", nodeB, "另一个节点");
    expect(runtime.send("p-1", nodeB)).toBe(true);
    expect(api.turnInputs.map(input => input.target)).toEqual([nodeA, nodeB]);
    runtime.dispose();
  });

  it("cancels only the selected target after a late start acknowledgement", async () => {
    const api = new FakeProjectApi();
    const runtime = new ProjectRuntime(api);
    runtime.subscribe("p-1", detail, () => undefined);
    runtime.setDraft("p-1", main, "Main 回合");
    runtime.setDraft("p-1", nodeA, "Node 回合");
    runtime.send("p-1", main);
    runtime.send("p-1", nodeA);
    const mainRequest = api.turnInputs[0]!.requestId;
    const nodeRequest = api.turnInputs[1]!.requestId;
    expect(runtime.cancel("p-1", nodeA)).toBe(true);
    api.resolveTurn(nodeRequest, "node-op");
    api.resolveTurn(mainRequest, "main-op");
    await Promise.resolve();
    expect(api.cancelled).toContain("node-op");
    expect(api.cancelled).not.toContain("main-op");
    api.emit({ type: "turn-error", projectId: "p-1", operationId: "node-op", failure: { code: "cancelled", message: "已停止" } });
    expect(runtime.targetSnapshot("p-1", nodeA).conversation.messages.at(-1)).toMatchObject({ status: "cancelled" });
    expect(runtime.targetSnapshot("p-1", main).busy).toBe(true);
    runtime.dispose();
  });

  it("binds an early turn error to the target whose start acknowledgement identifies its operation", async () => {
    const api = new FakeProjectApi();
    const runtime = new ProjectRuntime(api);
    runtime.subscribe("p-1", detail, () => undefined);
    runtime.setDraft("p-1", main, "Main 回合");
    runtime.setDraft("p-1", nodeA, "Node 回合");
    runtime.send("p-1", main);
    runtime.send("p-1", nodeA);
    const nodeRequest = api.turnInputs[1]!.requestId;
    api.emit({ type: "turn-error", projectId: "p-1", operationId: "node-op", failure: { code: "invalid-state", message: "节点状态已变化" } });
    api.resolveTurn(nodeRequest, "node-op");
    await Promise.resolve();
    expect(runtime.targetSnapshot("p-1", nodeA).busy).toBe(false);
    expect(runtime.targetSnapshot("p-1", nodeA).conversation.messages.at(-1)).toMatchObject({ status: "failed" });
    expect(runtime.targetSnapshot("p-1", main).busy).toBe(true);
    runtime.dispose();
  });

  it("keeps an in-flight node turn and draft across close and reopen while stopping only follow", async () => {
    const api = new FakeProjectApi();
    const runtime = new ProjectRuntime(api);
    const stop = runtime.subscribe("p-1", detail, () => undefined);
    runtime.setDraft("p-1", nodeA, "保留这条草稿");
    runtime.send("p-1", nodeA);
    runtime.setDraft("p-1", nodeA, "关闭时仍保留");
    const requestId = api.turnInputs[0]?.requestId ?? "request";
    await Promise.resolve();
    stop();
    await Promise.resolve();
    expect(api.cancelled).toContain("follow-1");
    expect(api.cancelled).not.toContain("turn-1");
    api.emit({ type: "turn-event", projectId: "p-1", operationId: "turn-1", event: started(requestId) });
    const updates: unknown[] = [];
    const reopen = runtime.subscribe("p-1", detail, () => updates.push(runtime.targetSnapshot("p-1", nodeA)));
    expect(runtime.targetSnapshot("p-1", nodeA).conversation.messages).toHaveLength(2);
    expect(runtime.targetSnapshot("p-1", nodeA).busy).toBe(true);
    expect(runtime.targetSnapshot("p-1", nodeA).draft).toBe("关闭时仍保留");
    reopen(); runtime.dispose();
  });

  it("shows follow failures and ignores events from another project", () => {
    const api = new FakeProjectApi();
    const runtime = new ProjectRuntime(api);
    runtime.subscribe("p-1", detail, () => undefined);
    api.emit({ type: "follow-error", projectId: "p-1", operationId: "follow-1", failure: { code: "host-unavailable", message: "断开" } });
    expect(runtime.snapshot("p-1", detail).followFailure?.message).toBe("断开");
    runtime.setDraft("p-1", nodeA, "本项目");
    runtime.send("p-1", nodeA);
    const before = runtime.targetSnapshot("p-1", nodeA).conversation;
    api.emit({ type: "turn-event", projectId: "p-2", operationId: "other", event: started("other") });
    expect(runtime.targetSnapshot("p-1", nodeA).conversation).toBe(before);
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

function started(requestId: string, turnId = "turn-1"): AgentTurnV2Event {
  return { type: "turn-started", sessionId: "session-1", requestId, turnId };
}

function completed(requestId: string, turnId = "turn-1"): AgentTurnV2Event {
  return { type: "turn-completed", sessionId: "session-1", requestId, turnId };
}

class FakeProjectApi implements DesktopProjectApi {
  readonly turnInputs: ProjectTurnInput[] = [];
  readonly cancelled: string[] = [];
  deferFollow = false;
  private followIndex = 0;
  private readonly followReplies: ((result: DesktopProjectResult<{ readonly subscriptionId: string }>) => void)[] = [];
  private readonly turnReplies = new Map<string, (result: DesktopProjectResult<{ readonly subscriptionId: string }>) => void>();
  private listener: ((event: DesktopProjectEvent) => void) | null = null;

  list = async () => ({ type: "ok", value: { projects: [] } } as const);
  create = async () => ({ type: "failed", failure: { code: "host-unavailable" as const, message: "unused" } } as const);
  get = async () => ({ type: "ok", value: detail } as const);
  autoRunStart = async () => ({ type: "failed", failure: { code: "host-unavailable" as const, message: "unused" } } as const);
  autoRunPause = this.autoRunStart;
  autoRunResume = this.autoRunStart;
  autoRunGet = async () => ({ type: "ok", value: null } as const);
  chooseWorkspace = async () => ({ type: "ok", value: null } as const);
  startTurn = (input: ProjectTurnInput): Promise<DesktopProjectResult<{ readonly subscriptionId: string }>> => {
    this.turnInputs.push(input);
    return new Promise(resolve => { this.turnReplies.set(input.requestId, resolve); });
  };
  startFollow = (): Promise<DesktopProjectResult<{ readonly subscriptionId: string }>> => {
    const subscriptionId = this.deferFollow ? (this.followIndex++ === 0 ? "follow-old" : "follow-new") : "follow-1";
    if (!this.deferFollow) return Promise.resolve({ type: "ok", value: { subscriptionId } });
    return new Promise(resolve => this.followReplies.push(result => resolve(result)));
  };
  cancel = async (operationId: string) => { this.cancelled.push(operationId); return { type: "ok", value: null } as const; };
  onEvent = (listener: (event: DesktopProjectEvent) => void): (() => void) => { this.listener = listener; return () => { this.listener = null; }; };

  resolveTurn(requestId: string, subscriptionId: string): void {
    const reply = this.turnReplies.get(requestId);
    if (reply === undefined) throw new Error("Unknown turn " + requestId);
    this.turnReplies.delete(requestId);
    reply({ type: "ok", value: { subscriptionId } });
  }
  resolveFollow(subscriptionId: string): void { this.followReplies.shift()?.({ type: "ok", value: { subscriptionId } }); }
  emit(event: DesktopProjectEvent): void { this.listener?.(event); }
}
