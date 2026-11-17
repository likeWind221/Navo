import type { ProjectDetailV1 } from "../../../../rpc/project.js";
import type { DesktopProjectApi, DesktopProjectEvent, DesktopProjectFailure } from "../../../shared/project.js";
import { ProjectTurns } from "./runtime/turns.js";
import type { ProjectChatTarget, ProjectTargetSnapshot } from "./runtime/turns.js";

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
  readonly stoppedFollowIds: Set<string>;
}

export class ProjectRuntime {
  private readonly entries = new Map<string, Entry>();
  private readonly turns: ProjectTurns;
  private removeEvents: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly api: DesktopProjectApi | undefined) {
    this.turns = new ProjectTurns(api, projectId => {
      const entry = this.entries.get(projectId);
      if (entry !== undefined) this.notify(entry);
    });
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
    this.entries.clear();
  }

  private ensure(projectId: string, detail: ProjectDetailV1): Entry {
    let entry = this.entries.get(projectId);
    if (entry === undefined) {
      entry = {
        projectId, detail,
        followFailure: null, listeners: new Set(), followId: null, followStarting: false,
        followGeneration: 0, stoppedFollowIds: new Set(),
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

