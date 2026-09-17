import { randomUUID } from "node:crypto";
import { Service } from "cordis";
import type { Context } from "cordis";
import { createNodeId } from "../brand/ids.js";
import type { NodeId, ProjectId, SessionId } from "../brand/ids.js";
import { NodeError } from "./errors.js";
import type { NodeDefinitionChange, NodeEvent, NodeEventDraft } from "./events.js";
import type { ControlPurpose, NodeConfirmation, NodeObjective, NodeRequirement, NodeSnapshot, NodeStatus } from "./model.js";
import { projectNode } from "./projector.js";
import { NodeBatch } from "./batch.js";

const emptyHistory: readonly NodeEvent[] = Object.freeze([]);

export class NodeStore extends Service {
  static inject = ["projects"];
  private readonly events = new Map<NodeId, readonly NodeEvent[]>();
  private coordinator: ((drafts: readonly NodeEventDraft[]) => void) | undefined;

  constructor(ctx: Context) { super(ctx, "nodes"); }

  coordinate(handler: (drafts: readonly NodeEventDraft[]) => void): () => void {
    if (this.coordinator) throw new NodeError("invalid-state", "Node coordinator already installed.");
    this.coordinator = handler;
    return () => { this.coordinator = () => { throw new NodeError("project-unavailable", "Node coordinator is unavailable."); }; };
  }

  create(input: CreateNodeInput): NodeSnapshot {
    return this.createBatch([{ nodeId: createNodeId(randomUUID()), input }])[0]!;
  }

  creation({ nodeId, input }: NewNodeInput): NodeEventDraft {
    const requirement = input.requirement ?? "required";
    if (input.kind !== undefined && input.kind !== "work" && input.kind !== "control") {
      throw new NodeError("invalid-state", "Invalid Node kind.");
    }
    return input.kind === "control"
      ? { type: "control-created", nodeId, data: { projectId: input.projectId, requirement, purpose: input.purpose, title: input.title } }
      : { type: "node-created", nodeId, data: { projectId: input.projectId, requirement, objective: input.objective } };
  }

  definitionChange(input: DefinitionChangeInput): NodeEventDraft {
    return {
      type: "definition-changed",
      nodeId: input.nodeId,
      data: {
        definition: input.definition,
        requirement: input.requirement,
        reason: input.reason,
        reviewedRevision: input.reviewedRevision,
      },
    };
  }

  createBatch(inputs: readonly NewNodeInput[]): readonly NodeSnapshot[] {
    this.dispatch(inputs.map(input => this.creation(input)));
    return Object.freeze(inputs.map(input => this.get(input.nodeId)!));
  }

  prepare(drafts: readonly NodeEventDraft[]): NodeBatch {
    const batch = new NodeBatch(id => this.getEvents(id));
    for (const draft of drafts) {
      const projectId = draft.type === "node-created" || draft.type === "control-created"
        ? draft.data.projectId : batch.get(draft.nodeId)?.node.projectId;
      if (!projectId) throw new NodeError("node-not-found", "Node was not found.");
      if (draft.type !== "work-ended") this.requireProject(projectId);
      batch.add(draft);
    }
    return batch;
  }

  commit(batch: NodeBatch): void {
    batch.commit((id, history) => this.events.set(id, history), event => this.notify(event));
  }

  restore(nodeId: NodeId, history: readonly NodeEvent[]): NodeSnapshot {
    if (this.events.has(nodeId)) throw new NodeError("invalid-state", "Cannot overwrite a Node.");
    const snapshot = projectNode(nodeId, history);
    if (!snapshot || !this.ctx.projects.get(snapshot.node.projectId)) throw new NodeError("project-unavailable", "Restore requires an existing project and history.");
    if (snapshot.sessionId && (this.getBySession(snapshot.sessionId) || this.ctx.projects.getByMainSession(snapshot.sessionId))) {
      throw new NodeError("session-already-bound", "Session already belongs to another owner.");
    }
    const copy = structuredClone(history);
    const freeze = (value: unknown): void => {
      if (!value || typeof value !== "object") return;
      Object.values(value).forEach(freeze);
      Object.freeze(value);
    };
    freeze(copy);
    this.events.set(nodeId, copy);
    return snapshot;
  }

  get(nodeId: NodeId): NodeSnapshot | undefined { return projectNode(nodeId, this.getEvents(nodeId)); }

  getBySession(sessionId: SessionId): NodeSnapshot | undefined {
    for (const id of this.events.keys()) {
      const node = this.get(id)!;
      if (node.sessionId === sessionId) return node;
    }
    return undefined;
  }

  getByProject(projectId: ProjectId): readonly NodeSnapshot[] {
    return Object.freeze([...this.events.keys()].map(id => this.get(id)!).filter(snapshot => snapshot.node.projectId === projectId));
  }

  getEvents(nodeId: NodeId): readonly NodeEvent[] { return this.events.get(nodeId) ?? emptyHistory; }

  bindSession(nodeId: NodeId, sessionId: SessionId): NodeSnapshot {
    const current = this.requireState(nodeId, "idle");
    if (current.node.kind !== "work") throw new NodeError("invalid-state", "Control nodes cannot bind Sessions.");
    if (current.sessionId !== undefined) throw new NodeError("node-already-bound", "Node already owns a Session.");
    if (this.getBySession(sessionId) || this.ctx.projects.getByMainSession(sessionId)) throw new NodeError("session-already-bound", "Session already has an owner.");
    return this.append({ type: "session-bound", nodeId, data: { sessionId } });
  }

  unlock(nodeId: NodeId, reason: string): NodeSnapshot {
    this.requireState(nodeId, "locked");
    return this.append({ type: "node-unlocked", nodeId, data: { reason } });
  }

  lock(nodeId: NodeId, reason: string): NodeSnapshot {
    this.requireState(nodeId, "idle");
    return this.append({ type: "node-locked", nodeId, data: { reason } });
  }

  beginWork(nodeId: NodeId): NodeSnapshot {
    if (this.requireState(nodeId, "idle").node.kind !== "work") throw new NodeError("invalid-state", "Control nodes cannot execute.");
    return this.append({ type: "work-started", nodeId, data: {} });
  }

  endWork(nodeId: NodeId): NodeSnapshot {
    return this.append({ type: "work-ended", nodeId, data: {} });
  }

  confirmCompletion(nodeId: NodeId, confirmation: NodeConfirmation): NodeSnapshot {
    this.review(nodeId, confirmation, "idle");
    return this.append({ type: "completion-confirmed", nodeId, data: confirmation });
  }

  skip(nodeId: NodeId, confirmation: NodeConfirmation): NodeSnapshot {
    this.review(nodeId, confirmation, "locked", "idle");
    return this.append({ type: "node-skipped", nodeId, data: confirmation });
  }

  setRequirement(nodeId: NodeId, requirement: NodeRequirement, reviewedRevision: number, reason: string): NodeSnapshot {
    const node = this.requireState(nodeId, "locked", "idle", "working", "completing", "skipped");
    if (node.revision !== reviewedRevision) throw new NodeError("stale-revision", "Review current Node before editing.");
    return this.append({ type: "requirement-changed", nodeId, data: { requirement, reviewedRevision, reason } });
  }

  requireState(nodeId: NodeId, ...states: readonly NodeStatus[]): NodeSnapshot {
    const node = this.get(nodeId);
    if (!node) throw new NodeError("node-not-found", "Node was not found.");
    this.requireProject(node.node.projectId);
    if (!states.includes(node.status)) throw new NodeError("invalid-state", "Node is " + node.status + ".");
    return node;
  }

  private review(nodeId: NodeId, confirmation: NodeConfirmation, ...states: NodeStatus[]): void {
    if (this.requireState(nodeId, ...states).revision !== confirmation.reviewedRevision) {
      throw new NodeError("stale-revision", "Review the current Node revision.");
    }
  }

  private requireProject(projectId: ProjectId): void {
    if (this.ctx.projects.get(projectId)?.status !== "active") throw new NodeError("project-unavailable", "Node requires an active Project.");
  }

  private dispatch(drafts: readonly NodeEventDraft[]): void {
    if (this.coordinator) this.coordinator(drafts);
    else this.commit(this.prepare(drafts));
  }

  private append(draft: NodeEventDraft): NodeSnapshot {
    this.dispatch([draft]);
    return this.get(draft.nodeId)!;
  }

  private notify(event: NodeEvent): void {
    queueMicrotask(() => {
      void this.ctx.parallel("node/event", event).catch((error: unknown) => {
        this.ctx.logger("node").warn("Node event observer failed: %o", error);
      });
    });
  }
}

export type CreateNodeInput = { readonly projectId: ProjectId; readonly requirement?: NodeRequirement } & (
  | { readonly kind?: "work"; readonly objective: NodeObjective }
  | { readonly kind: "control"; readonly purpose: ControlPurpose; readonly title: string }
);
export interface NewNodeInput { readonly nodeId: NodeId; readonly input: CreateNodeInput; }
export interface DefinitionChangeInput {
  readonly nodeId: NodeId;
  readonly definition: NodeDefinitionChange;
  readonly requirement: NodeRequirement;
  readonly reviewedRevision: number;
  readonly reason: string;
}

declare module "cordis" {
  interface Context { nodes: NodeStore; }
  interface Events { "node/event": (event: NodeEvent) => void; }
}
