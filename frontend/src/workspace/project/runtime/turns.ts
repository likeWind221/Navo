import type { ProjectTurnInput, ProjectTurnTarget } from "../../../../../rpc/project.js";
import type { DesktopProjectApi, DesktopProjectEvent, DesktopProjectFailure } from "../../../../shared/project.js";
import { conversationReducer, initialConversationState } from "../../chat/conversation.js";
import type { ConversationAction, ConversationState } from "../../chat/conversation.js";

export type ProjectChatTarget = Extract<ProjectTurnTarget, { readonly kind: "main" } | { readonly kind: "node" }>;

export interface ProjectTargetSnapshot {
  readonly conversation: ConversationState;
  readonly draft: string;
  readonly busy: boolean;
}

interface TargetEntry {
  conversation: ConversationState;
  draft: string;
  active: { readonly requestId: string; operationId: string | null } | null;
  cancelRequested: boolean;
}

interface ProjectEntry {
  readonly targets: Map<string, TargetEntry>;
}

interface PendingFailure {
  readonly projectId: string;
  readonly failure: DesktopProjectFailure;
}

export class ProjectTurns {
  private readonly entries = new Map<string, ProjectEntry>();
  private readonly pendingFailures = new Map<string, PendingFailure>();
  private disposed = false;

  constructor(
    private readonly api: DesktopProjectApi | undefined,
    private readonly changed: (projectId: string) => void,
  ) {}

  snapshot(projectId: string, target: ProjectChatTarget): ProjectTargetSnapshot {
    const entry = this.ensure(projectId, target);
    return { conversation: entry.conversation, draft: entry.draft, busy: entry.active !== null };
  }

  setDraft(projectId: string, target: ProjectChatTarget, value: string): void {
    const entry = this.ensure(projectId, target);
    entry.draft = value;
    this.changed(projectId);
  }

  send(projectId: string, target: ProjectChatTarget): boolean {
    const entry = this.ensure(projectId, target);
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
    this.changed(projectId);
    const api = this.api;
    if (api === undefined) {
      this.reject(entry, requestId, { code: "bridge-closed", message: target.kind === "main"
        ? "项目对话仅在桌面应用中可用"
        : "节点对话仅在桌面应用中可用" });
      this.changed(projectId);
      return true;
    }
    const input: ProjectTurnInput = { projectId, requestId, text, target };
    void api.startTurn(input).then(result => {
      if (this.disposed || entry.active?.requestId !== requestId) {
        if (result.type === "ok") void api.cancel(result.value.subscriptionId);
        return;
      }
      if (result.type !== "ok") {
        this.reject(entry, requestId, result.failure);
        this.changed(projectId);
        return;
      }
      entry.active = { requestId, operationId: result.value.subscriptionId };
      const pending = this.pendingFailures.get(result.value.subscriptionId);
      if (pending !== undefined && pending.projectId === projectId) {
        this.pendingFailures.delete(result.value.subscriptionId);
        this.applyFailure(entry, requestId, pending.failure);
      } else if (entry.cancelRequested) {
        void api.cancel(result.value.subscriptionId);
      }
      this.changed(projectId);
    });
    return true;
  }

  cancel(projectId: string, target: ProjectChatTarget): boolean {
    const entry = this.ensure(projectId, target);
    if (entry.active === null) return false;
    entry.cancelRequested = true;
    if (entry.active.operationId !== null) void this.api?.cancel(entry.active.operationId);
    return true;
  }

  receive(event: DesktopProjectEvent): void {
    if (this.disposed) return;
    const project = this.entries.get(event.projectId);
    if (project === undefined) return;
    if (event.type === "turn-event") {
      const entry = findTarget(project, entry => entry.active?.requestId === event.event.requestId);
      if (entry === undefined) return;
      const active = entry.active;
      if (active === null) return;
      if (active.operationId !== null && active.operationId !== event.operationId) return;
      this.dispatch(entry, { type: "agent-event", update: { type: "turn-event", event: event.event } });
      if (isTerminal(event.event.type)) entry.active = null;
      this.changed(event.projectId);
      return;
    }
    if (event.type !== "turn-error") return;
    const entry = findTarget(project, entry => entry.active?.operationId === event.operationId);
    if (entry !== undefined) {
      if (entry.active !== null) this.applyFailure(entry, entry.active.requestId, event.failure);
      this.changed(event.projectId);
      return;
    }
    const pending = [...project.targets.values()].filter(entry => entry.active?.operationId === null);
    if (pending.length === 0) return;
    if (pending.length === 1) {
      const entry = pending[0]!;
      if (entry.active !== null) this.applyFailure(entry, entry.active.requestId, event.failure);
      this.changed(event.projectId);
      return;
    }
    this.pendingFailures.set(event.operationId, { projectId: event.projectId, failure: event.failure });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const project of this.entries.values()) {
      for (const entry of project.targets.values()) {
        if (entry.active !== null && entry.active.operationId !== null) void this.api?.cancel(entry.active.operationId);
      }
    }
    this.entries.clear();
    this.pendingFailures.clear();
  }

  private ensure(projectId: string, target: ProjectChatTarget): TargetEntry {
    let project = this.entries.get(projectId);
    if (project === undefined) {
      project = { targets: new Map() };
      this.entries.set(projectId, project);
    }
    const key = targetKey(target);
    let entry = project.targets.get(key);
    if (entry === undefined) {
      entry = {
        conversation: initialConversationState,
        draft: "",
        active: null,
        cancelRequested: false,
      };
      project.targets.set(key, entry);
    }
    return entry;
  }

  private dispatch(entry: TargetEntry, action: ConversationAction): void {
    entry.conversation = conversationReducer(entry.conversation, action, Date.now());
  }

  private reject(entry: TargetEntry, requestId: string, failure: DesktopProjectFailure): void {
    this.dispatch(entry, { type: "turn-command-failed", requestId, failure });
    entry.active = null;
    entry.cancelRequested = false;
  }

  private applyFailure(entry: TargetEntry, requestId: string, failure: DesktopProjectFailure): void {
    this.dispatch(entry, { type: "agent-event", update: { type: "turn-error", requestId, failure } });
    entry.active = null;
    entry.cancelRequested = false;
  }
}

function targetKey(target: ProjectChatTarget): string {
  return target.kind === "main" ? "main" : `node:${target.nodeId}`;
}

function findTarget(project: ProjectEntry, predicate: (entry: TargetEntry) => boolean): TargetEntry | undefined {
  for (const entry of project.targets.values()) {
    if (predicate(entry)) return entry;
  }
  return undefined;
}

function isTerminal(type: string): boolean {
  return type === "turn-completed" || type === "turn-cancelled" || type === "turn-failed" || type === "turn-truncated";
}
