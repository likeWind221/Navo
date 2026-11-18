import type { NodeReviewInput, NodeV1, ProjectDetailV1 } from "../../../../rpc/project.js";
import type { DesktopProjectApi, DesktopProjectEvent, DesktopProjectFailure, DesktopProjectResult } from "../../../shared/project.js";
import { ProjectReviews } from "./runtime/review.js";
import type { ProjectReviewSnapshot } from "./runtime/review.js";
import { ProjectTurns } from "./runtime/turns.js";
import type { ProjectChatTarget, ProjectTargetSnapshot } from "./runtime/turns.js";
import type { DesktopSessionApi } from "../../../shared/session.js";
import type { SessionHistoryEntryV1, SessionHistoryCursorV1 } from "../../../../rpc/session.js";

export interface ProjectRuntimeSnapshot {
  readonly detail: ProjectDetailV1 | null;
  readonly followFailure: DesktopProjectFailure | null;
}

interface Entry {
  readonly projectId: string;
  detail: ProjectDetailV1 | null;
  followFailure: DesktopProjectFailure | null;
  readonly listeners: Set<() => void>;
  followId: string | null;
  followStarting: boolean;
  followGeneration: number;
  detailGeneration: number;
  readonly stoppedFollowIds: Set<string>;
}

export class ProjectRuntime {
  private readonly entries = new Map<string, Entry>();
  private readonly turns: ProjectTurns;
  private readonly reviews: ProjectReviews;
  private readonly histories = new Map<string, Promise<readonly SessionHistoryEntryV1[]>>();
  private readonly nodeHistories = new Map<string, Promise<{ readonly established: boolean; readonly entries: readonly SessionHistoryEntryV1[] }>>();
  private removeEvents: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly api: DesktopProjectApi | undefined, private readonly session?: DesktopSessionApi) {
    this.turns = new ProjectTurns(api, projectId => {
      const entry = this.entries.get(projectId);
      if (entry !== undefined) this.notify(entry);
    });
    this.reviews = new ProjectReviews(api, projectId => {
      const entry = this.entries.get(projectId);
      if (entry !== undefined) this.notify(entry);
    });
  }

  mainHistory(sessionId: string): Promise<readonly SessionHistoryEntryV1[]> {
    const existing = this.histories.get(sessionId);
    if (existing !== undefined) return existing;
    const request = this.readMainHistory(sessionId);
    this.histories.set(sessionId, request);
    void request.catch(() => { if (this.histories.get(sessionId) === request) this.histories.delete(sessionId); });
    return request;
  }

  nodeHistory(projectId: string, nodeId: string): Promise<{ readonly established: boolean; readonly entries: readonly SessionHistoryEntryV1[] }> {
    const key = JSON.stringify([projectId, nodeId]);
    const existing = this.nodeHistories.get(key);
    if (existing !== undefined) return existing;
    const request = this.readNodeHistory(projectId, nodeId);
    this.nodeHistories.set(key, request);
    void request.catch(() => { if (this.nodeHistories.get(key) === request) this.nodeHistories.delete(key); });
    return request;
  }

  private async readNodeHistory(projectId: string, nodeId: string): Promise<{ readonly established: boolean; readonly entries: readonly SessionHistoryEntryV1[] }> {
    if (this.api === undefined) return { established: false, entries: [] };
    const result = await this.api.getSessions({ projectId });
    if (result.type !== "ok" || result.value.projectId !== projectId) throw new Error("无法查找节点会话，请重试");
    const node = result.value.sessions.find(entry => entry.owner.kind === "node" && entry.owner.nodeId === nodeId);
    if (node === undefined) throw new Error("未找到节点会话状态，请重试");
    if (node.status === "unavailable") throw new Error("节点会话暂时无法读取，请检查后端数据");
    if (node.status === "unestablished") return { established: false, entries: [] };
    return { established: true, entries: await this.mainHistory(node.sessionId) };
  }

  private async readMainHistory(sessionId: string): Promise<readonly SessionHistoryEntryV1[]> {
    if (this.session === undefined) {
      if (this.api === undefined) return [];
      throw new Error("会话历史接口不可用");
    }
    const entries: SessionHistoryEntryV1[] = [];
    let cursor: SessionHistoryCursorV1 | undefined;
    do {
      const result = await this.session.getHistory({ sessionId, limit: 50, ...(cursor === undefined ? {} : { cursor }) });
      if (result.type !== "ok") throw new Error(result.failure.code === "history-changed" ? "历史在读取期间发生变化，请重试" : "无法读取已保存的对话，请重试");
      entries.push(...result.value.entries);
      cursor = result.value.nextCursor ?? undefined;
    } while (cursor !== undefined);
    return entries;
  }

  connect(): void {
    if (this.api === undefined || this.removeEvents !== null || this.disposed) return;
    this.removeEvents = this.api.onEvent(event => this.receive(event));
  }

  disconnect(): void {
    this.removeEvents?.();
    this.removeEvents = null;
  }

  subscribe(projectId: string, detail: ProjectDetailV1, listener: () => void): () => void {
    this.connect();
    const entry = this.ensure(projectId, detail);
    entry.listeners.add(listener);
    this.startFollow(entry);
    listener();
    return () => {
      if (!entry.listeners.delete(listener) || entry.listeners.size !== 0) return;
      this.stopFollow(entry);
    };
  }

  snapshot(projectId: string, detail: ProjectDetailV1): ProjectRuntimeSnapshot {
    return this.read(this.ensure(projectId, detail));
  }

  targetSnapshot(projectId: string, target: ProjectChatTarget): ProjectTargetSnapshot {
    return this.turns.snapshot(projectId, target);
  }

  setDraft(projectId: string, target: ProjectChatTarget, value: string): void {
    this.turns.setDraft(projectId, target, value);
  }

  send(projectId: string, target: ProjectChatTarget): boolean {
    return this.turns.send(projectId, target);
  }

  cancel(projectId: string, target: ProjectChatTarget): boolean {
    return this.turns.cancel(projectId, target);
  }

  reviewSnapshot(projectId: string, nodeId: string): ProjectReviewSnapshot {
    return this.reviews.snapshot(projectId, nodeId);
  }

  async review(projectId: string, nodeId: string, action: NodeReviewInput["action"], reason: string, reviewedRevision: number): Promise<DesktopProjectResult<NodeV1>> {
    const result = await this.reviews.review({ projectId, nodeId, action, reason, reviewedRevision });
    const entry = this.entries.get(projectId);
    if (entry !== undefined) {
      if (result.type === "ok") this.replaceNode(entry, result.value);
      else if (result.failure.code === "revision-conflict") void this.refresh(entry);
      this.notify(entry);
    }
    return result;
  }

  dismissReviewFailure(projectId: string, nodeId: string): void {
    this.reviews.dismiss(projectId, nodeId);
  }

  reconnect(projectId: string, detail: ProjectDetailV1): void {
    const entry = this.ensure(projectId, detail);
    if (entry.followId !== null || entry.followStarting || entry.listeners.size === 0) return;
    entry.followFailure = null;
    this.startFollow(entry);
    this.notify(entry);
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.disconnect();
    for (const entry of this.entries.values()) {
      this.stopFollow(entry);
      entry.listeners.clear();
    }
    this.turns.dispose();
    this.reviews.dispose();
    this.entries.clear();
    this.histories.clear();
    this.nodeHistories.clear();
  }

  private ensure(projectId: string, detail: ProjectDetailV1): Entry {
    let entry = this.entries.get(projectId);
    if (entry === undefined) {
      entry = {
        projectId, detail,
        followFailure: null, listeners: new Set(), followId: null, followStarting: false,
        followGeneration: 0, detailGeneration: 0, stoppedFollowIds: new Set(),
      };
      this.entries.set(projectId, entry);
    } else if (entry.detail === null) entry.detail = detail;
    return entry;
  }

  private startFollow(entry: Entry): void {
    if (this.api === undefined || this.disposed || entry.listeners.size === 0 || entry.followId !== null || entry.followStarting) return;
    entry.followStarting = true;
    const generation = ++entry.followGeneration;
    void this.api.startFollow({ projectId: entry.projectId }).then(result => {
      if (generation !== entry.followGeneration) {
        if (result.type === "ok") {
          this.rememberStoppedFollow(entry, result.value.subscriptionId);
          void this.api?.cancel(result.value.subscriptionId);
        }
        return;
      }
      entry.followStarting = false;
      if (result.type !== "ok") {
        if (entry.listeners.size > 0) {
          entry.followFailure = result.failure;
          this.notify(entry);
        }
        return;
      }
      if (entry.stoppedFollowIds.has(result.value.subscriptionId) || entry.listeners.size === 0 || this.disposed) {
        this.rememberStoppedFollow(entry, result.value.subscriptionId);
        void this.api?.cancel(result.value.subscriptionId);
        return;
      }
      if (entry.followId === null) entry.followId = result.value.subscriptionId;
      this.notify(entry);
    });
  }

  private stopFollow(entry: Entry): void {
    entry.followGeneration += 1;
    entry.followStarting = false;
    if (entry.followId !== null) {
      this.rememberStoppedFollow(entry, entry.followId);
      void this.api?.cancel(entry.followId);
      entry.followId = null;
    }
  }

  private receive(event: DesktopProjectEvent): void {
    if (this.disposed) return;
    const entry = this.entries.get(event.projectId);
    if (entry === undefined) return;
    if (event.type === "follow-snapshot" || event.type === "follow-error") {
      if (entry.stoppedFollowIds.has(event.operationId)) return;
      if (entry.followId !== null && entry.followId !== event.operationId) return;
      entry.followId = event.operationId;
      if (event.type === "follow-snapshot") {
        entry.followFailure = null;
        entry.detailGeneration += 1;
        entry.detail = event.snapshot.detail;
      } else {
        this.rememberStoppedFollow(entry, event.operationId);
        entry.followGeneration += 1;
        entry.followStarting = false;
        entry.followFailure = event.failure;
        entry.followId = null;
      }
      this.notify(entry);
      return;
    }
    this.turns.receive(event);
  }

  private notify(entry: Entry): void { for (const listener of entry.listeners) listener(); }

  private replaceNode(entry: Entry, node: NodeV1): void {
    const detail = entry.detail;
    if (detail === null) return;
    const roadmap = detail.roadmap;
    if (roadmap === null) return;
    const current = roadmap.nodes.find(item => item.nodeId === node.nodeId);
    if (current === undefined || current.revision > node.revision) return;
    const nodes = roadmap.nodes.map(item => item.nodeId === node.nodeId ? node : item);
    entry.detail = { ...detail, roadmap: { ...roadmap, nodes } };
    entry.detailGeneration += 1;
  }

  private refresh(entry: Entry): void {
    if (this.api === undefined || this.disposed) return;
    const generation = entry.detailGeneration;
    void this.api.get({ projectId: entry.projectId }).then(result => {
      if (this.disposed || generation !== entry.detailGeneration || result.type !== "ok") return;
      entry.detailGeneration += 1;
      entry.detail = result.value;
      this.notify(entry);
    });
  }

  private rememberStoppedFollow(entry: Entry, operationId: string): void {
    if (entry.stoppedFollowIds.size >= 16) {
      const oldest = entry.stoppedFollowIds.values().next().value;
      if (oldest !== undefined) entry.stoppedFollowIds.delete(oldest);
    }
    entry.stoppedFollowIds.add(operationId);
  }

  private read(entry: Entry): ProjectRuntimeSnapshot {
    return { detail: entry.detail, followFailure: entry.followFailure };
  }
}

