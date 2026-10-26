import type { ProjectDetailV1, ProjectTurnInput } from "../../../../rpc/project.js";
import type { DesktopProjectApi, DesktopProjectEvent, DesktopProjectFailure } from "../../../shared/project.js";
import { conversationReducer, initialConversationState } from "../chat/conversation.js";
import type { ConversationAction, ConversationState } from "../chat/conversation.js";

export interface ProjectRuntimeSnapshot {
  readonly conversation: ConversationState;
  readonly draft: string;
  readonly detail: ProjectDetailV1 | null;
  readonly followFailure: DesktopProjectFailure | null;
  readonly busy: boolean;
}

interface Entry {
  readonly projectId: string;
  conversation: ConversationState;
  draft: string;
  detail: ProjectDetailV1 | null;
  followFailure: DesktopProjectFailure | null;
  readonly listeners: Set<() => void>;
  followId: string | null;
  followStarting: boolean;
  followGeneration: number;
  readonly stoppedFollowIds: Set<string>;
  active: { readonly requestId: string; readonly operationId: string | null } | null;
  cancelRequested: boolean;
}

export class ProjectRuntime {
  private readonly entries = new Map<string, Entry>();
  private removeEvents: (() => void) | null = null;
  private disposed = false;

  constructor(private readonly api: DesktopProjectApi | undefined) {}

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

  setDraft(projectId: string, detail: ProjectDetailV1, value: string): void {
    const entry = this.ensure(projectId, detail);
    entry.draft = value;
    this.notify(entry);
  }

  send(projectId: string, detail: ProjectDetailV1): boolean {
    const entry = this.ensure(projectId, detail);
    const text = entry.draft.trim();
    if (!text || entry.active !== null) return false;
    const requestId = crypto.randomUUID();
    entry.active = { requestId, operationId: null };
    entry.cancelRequested = false;
    entry.draft = "";
    this.dispatch(entry, {
      type: "turn-submitted",
      requestId,
      userMessageId: `user-${requestId}`,
      assistantMessageId: `assistant-${requestId}`,
      text,
    });
    this.notify(entry);
    if (this.api === undefined) {
      this.dispatch(entry, { type: "turn-command-failed", requestId, failure: { code: "bridge-unavailable", message: "项目对话仅在桌面应用中可用" } });
      entry.active = null;
      this.notify(entry);
      return true;
    }
    const api = this.api;
    const input: ProjectTurnInput = { projectId, requestId, text, target: { kind: "main" } };
    void api.startTurn(input).then(result => {
      if (result.type !== "ok") {
        if (entry.active?.requestId === requestId) {
          this.dispatch(entry, { type: "turn-command-failed", requestId, failure: result.failure });
          entry.active = null;
          this.notify(entry);
        }
        return;
      }
      if (entry.active?.requestId !== requestId) {
        void api.cancel(result.value.subscriptionId);
        return;
      }
      entry.active = { requestId, operationId: result.value.subscriptionId };
      if (entry.cancelRequested) void api.cancel(result.value.subscriptionId);
      this.notify(entry);
    });
    return true;
  }

  cancel(projectId: string, detail: ProjectDetailV1): boolean {
    const entry = this.ensure(projectId, detail);
    if (entry.active === null) return false;
    entry.cancelRequested = true;
    if (entry.active.operationId !== null) void this.api?.cancel(entry.active.operationId);
    return true;
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
      if (entry.active?.operationId !== null && entry.active !== null) void this.api?.cancel(entry.active.operationId);
      entry.listeners.clear();
    }
    this.entries.clear();
  }

  private ensure(projectId: string, detail: ProjectDetailV1): Entry {
    let entry = this.entries.get(projectId);
    if (entry === undefined) {
      entry = {
        projectId, conversation: initialConversationState, draft: "", detail,
        followFailure: null, listeners: new Set(), followId: null, followStarting: false,
        followGeneration: 0, stoppedFollowIds: new Set(), active: null, cancelRequested: false,
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
    const active = entry.active;
    if (active === null) return;
    if (event.type === "turn-event") {
      if (event.event.requestId !== active.requestId) return;
      this.dispatch(entry, { type: "agent-event", update: { type: "turn-event", event: event.event } });
      if (isTerminal(event.event.type)) entry.active = null;
    } else {
      if (active.operationId !== null && active.operationId !== event.operationId) return;
      this.dispatch(entry, { type: "agent-event", update: { type: "turn-error", requestId: active.requestId, failure: event.failure } });
      entry.active = null;
    }
    this.notify(entry);
  }

  private dispatch(entry: Entry, action: ConversationAction): void {
    entry.conversation = conversationReducer(entry.conversation, action, Date.now());
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
    return { conversation: entry.conversation, draft: entry.draft, detail: entry.detail, followFailure: entry.followFailure, busy: entry.active !== null };
  }
}

function isTerminal(type: string): boolean {
  return type === "turn-completed" || type === "turn-cancelled" || type === "turn-failed" || type === "turn-truncated";
}

