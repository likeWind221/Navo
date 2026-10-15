import { randomUUID } from "node:crypto";
import { Service } from "cordis";
import type { Context } from "cordis";
import { createEventId, createProjectId } from "../brand/ids.js";
import type { NodeId, ProjectId } from "../brand/ids.js";
import type { NodeDefinitionChange, NodeEventDraft } from "../node/events.js";
import type { NodeRequirement, NodeSnapshot } from "../node/model.js";
import type { NodeBatch } from "../node/batch.js";
import type { NodeStore } from "../node/store.js";
import { StorageError } from "../storage/errors.js";
import { buildRoadmapGraph } from "./graph.js";
import { RoadmapError } from "./errors.js";
import { freezeRoadmapEvent } from "./events.js";
import type { RoadmapChange, RoadmapEvent } from "./events.js";
import type { RoadmapDefinition, RoadmapGraph, RoadmapSnapshot } from "./model.js";
import { projectRoadmap } from "./projector.js";

export class RoadmapStore extends Service {
  static inject = ["storage", "projects", "nodes"];
  private readonly histories = new Map<ProjectId, readonly RoadmapEvent[]>();
  private readonly snapshots = new Map<ProjectId, RoadmapSnapshot>();

  constructor(ctx: Context) {
    super(ctx, "roadmaps");
    const nodes = this.ctx.nodes;
    nodes.coordinate(drafts => this.commitNodeAction(nodes, drafts));
    for (const [projectId, stored] of ctx.storage.recovery.events.get("roadmap")!) {
      try {
        if (stored.projectId !== projectId) throw new RoadmapError("invalid-event-stream", `Roadmap is filed under Project ${stored.projectId}.`);
        if (!this.ctx.projects.get(createProjectId(projectId))) throw new RoadmapError("project-unavailable", "Roadmap Project does not exist.");
        this.restoreHistory(createProjectId(projectId), stored.events as readonly RoadmapEvent[], false);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : "unknown failure";
        throw new StorageError("invalid-record", `Stored roadmap history ${projectId} is invalid: ${reason}`, { cause: error });
      }
    }
  }

  create(input: CreateRoadmapInput): RoadmapSnapshot {
    const projectId = input.definition.projectId;
    if (this.snapshots.has(projectId)) throw new RoadmapError("already-exists", "Project already owns a roadmap");
    const project = this.ctx.projects.get(projectId);
    if (project?.status !== "active") throw new RoadmapError("project-unavailable", "Creating a roadmap requires an active project");
    if (project.goal === null) throw new RoadmapError("goal-required", "Creating a roadmap requires a confirmed project goal");
    const nodeEvents = (input.newNodes ?? []).map(value => this.ctx.nodes.creation(value));
    const nodeBatch = this.ctx.nodes.prepare(nodeEvents);
    const candidateNodes = new Map(this.ctx.nodes.getByProject(projectId).map(value => [value.node.id, value]));
    for (const draft of nodeEvents) candidateNodes.set(draft.nodeId, nodeBatch.get(draft.nodeId)!);
    const event = freezeRoadmapEvent({ ...this.header(projectId, 0, input.reason), type: "roadmap-created", definition: input.definition });
    const snapshot = projectRoadmap(projectId, [event], [...candidateNodes.values()].map(value => value.node));
    if (!snapshot) throw new RoadmapError("invalid-event-stream", "Invalid roadmap event");
    this.findUnlocks(snapshot.graph, candidateNodes, nodeBatch);
    this.commitTogether(nodeBatch, projectId, Object.freeze([event]), snapshot);
    return snapshot;
  }

  change(input: ChangeRoadmapInput): RoadmapSnapshot {
    const current = this.get(input.projectId);
    if (!current) throw new RoadmapError("not-found", "Roadmap does not exist");
    if (current.revision !== input.baseRevision) throw new RoadmapError("stale-revision", "Read the current roadmap before editing");
    if (this.ctx.projects.get(input.projectId)?.status !== "active") throw new RoadmapError("project-unavailable", "Editing requires an active project");

    const event = freezeRoadmapEvent({ ...this.header(input.projectId, input.baseRevision, input.reason), type: "roadmap-changed", changes: input.changes });
    const history = Object.freeze([...this.getEvents(input.projectId), event]);
    const newNodeEvents = (input.newNodes ?? []).map(value => this.ctx.nodes.creation(value));
    const nodeUpdateEvents = (input.nodeUpdates ?? []).map(value => this.ctx.nodes.definitionChange({
      nodeId: value.nodeId,
      definition: value.definition,
      requirement: value.requirement,
      reviewedRevision: value.reviewedRevision,
      reason: input.reason,
    }));
    const drafts = [...newNodeEvents, ...nodeUpdateEvents];
    const batch = this.ctx.nodes.prepare(drafts);

    const currentNodes = new Map(this.ctx.nodes.getByProject(input.projectId).map(value => [value.node.id, value]));
    const candidateNodes = new Map(currentNodes);
    for (const draft of drafts) candidateNodes.set(draft.nodeId, batch.get(draft.nodeId)!);

    const snapshot = projectRoadmap(
      input.projectId,
      history,
      [...candidateNodes.values()].map(value => value.node),
    );
    if (!snapshot) throw new RoadmapError("invalid-reference", "Every roadmap node must exist");

    for (const currentNode of currentNodes.values()) {
      if (currentNode.status !== "working" && currentNode.status !== "submitted") continue;
      const relation = snapshot.graph.relations.find(value => value.nodeId === currentNode.node.id);
      if (!relation || !relation.requiredBefore.every(required => this.isTerminal(candidateNodes.get(required)))) {
        throw new RoadmapError("working-node", "Roadmap change would invalidate a working or submitted Node");
      }
    }
    for (const relation of snapshot.graph.relations) {
      const currentNode = currentNodes.get(relation.nodeId);
      if (currentNode?.status === "idle" && !relation.requiredBefore.every(required => this.isTerminal(candidateNodes.get(required)))) {
        candidateNodes.set(relation.nodeId, batch.add({ type: "node-locked", nodeId: relation.nodeId, data: { reason: "Roadmap dependencies changed" } }));
      }
    }

    this.findUnlocks(snapshot.graph, candidateNodes, batch);
    this.commitTogether(batch, input.projectId, history, snapshot);
    return snapshot;
  }

  get(projectId: ProjectId): RoadmapSnapshot | undefined { return this.snapshots.get(projectId); }
  getEvents(projectId: ProjectId): readonly RoadmapEvent[] { return this.histories.get(projectId) ?? Object.freeze([]); }

  map(projectId: ProjectId): RoadmapMap {
    const roadmap = this.get(projectId);
    const project = this.ctx.projects.get(projectId);
    if (!roadmap || !project) throw new RoadmapError("not-found", "Project roadmap does not exist");
    const nodes = roadmap.graph.definition.nodes.map(id => this.ctx.nodes.get(id)).filter((value): value is NodeSnapshot => value !== undefined);
    return freeze({ projectId, projectStatus: project.status, projectRevision: project.revision, roadmapRevision: roadmap.revision, nodes, edges: roadmap.graph.definition.edges });
  }

  restore(projectId: ProjectId, events: readonly RoadmapEvent[]): RoadmapSnapshot {
    return this.restoreHistory(projectId, events, true);
  }

  private restoreHistory(projectId: ProjectId, events: readonly RoadmapEvent[], emit: boolean): RoadmapSnapshot {
    if (this.snapshots.has(projectId)) throw new RoadmapError("already-exists", "Cannot overwrite an existing roadmap");
    const history = Object.freeze(events.map(freezeRoadmapEvent));
    const snapshot = projectRoadmap(projectId, history, this.ctx.nodes.getByProject(projectId).map(value => value.node));
    if (!snapshot) throw new RoadmapError("invalid-event-stream", "Cannot restore an empty history");
    this.commitHistory(projectId, history, snapshot, emit);
    return snapshot;
  }

  private commitTogether(batch: NodeBatch, projectId: ProjectId, history: readonly RoadmapEvent[], snapshot: RoadmapSnapshot): void {
    this.ctx.storage.atomic(() => {
      this.ctx.nodes.commit(batch);
      this.ctx.storage.write(tx => tx.appendEvents({
        domain: "roadmap", ownerId: projectId, projectId, firstSeq: snapshot.revision, events: history.slice(snapshot.revision - 1),
      }), () => this.commitHistory(projectId, history, snapshot));
    });
  }

  private commitHistory(projectId: ProjectId, history: readonly RoadmapEvent[], snapshot: RoadmapSnapshot, emit = true): void {
    this.histories.set(projectId, history);
    this.snapshots.set(projectId, snapshot);
    if (emit) this.ctx.emit("project/changed", projectId);
  }

  private commitNodeAction(nodes: NodeStore, drafts: readonly NodeEventDraft[]): void {
    if (drafts.length === 0) return;
    if (drafts.every(draft => draft.type === "node-created" || draft.type === "control-created")) {
      nodes.commit(nodes.prepare(drafts));
      return;
    }
    const first = drafts[0];
    const id = first?.nodeId;
    const node = id ? nodes.get(id) : undefined;
    if (!node) throw new RoadmapError("not-found", "Node does not exist");
    const projectId = node.node.projectId;
    const roadmap = this.get(projectId);
    if (!roadmap) {
      nodes.commit(nodes.prepare(drafts));
      return;
    }
    const batch = nodes.prepare(drafts);
    const proposed = new Map<NodeId, NodeSnapshot>();
    for (const value of nodes.getByProject(projectId)) proposed.set(value.node.id, value);
    for (const draft of drafts) proposed.set(draft.nodeId, batch.get(draft.nodeId)!);
    const graph = buildRoadmapGraph(roadmap.graph.definition, [...proposed.values()].map(value => value.node));
    for (const draft of drafts.filter(value => value.type === "node-unlocked")) {
      const relation = graph.relations.find(value => value.nodeId === draft.nodeId)!;
      if (!relation.requiredBefore.every(required => this.isTerminal(proposed.get(required)))) {
        throw new RoadmapError("invalid-reference", "Node dependencies are not complete");
      }
    }
    const added = new Set(drafts.map(draft => draft.nodeId));
    this.findUnlocks(graph, proposed, batch, added);
    nodes.commit(batch);
  }

  private findUnlocks(graph: RoadmapGraph, nodes: Map<NodeId, NodeSnapshot>, batch: NodeBatch, added = new Set<NodeId>()): void {
    for (const id of graph.topologicalOrder) {
      const snapshot = nodes.get(id);
      const relation = graph.relations.find(value => value.nodeId === id)!;
      if (!snapshot || snapshot.status !== "locked" || added.has(id)) continue;
      if (!relation.requiredBefore.every(required => this.isTerminal(nodes.get(required)))) continue;
      nodes.set(id, batch.add({ type: "node-unlocked", nodeId: id, data: { reason: "Required dependencies resolved" } }));
      added.add(id);
    }
  }

  private isTerminal(snapshot: NodeSnapshot | undefined): boolean {
    return snapshot?.status === "completing" || snapshot?.status === "skipped";
  }

  private header(projectId: ProjectId, baseRevision: number, reason: string) {
    return { version: 1 as const, id: createEventId(randomUUID()), projectId, baseRevision, revision: baseRevision + 1, timestamp: new Date().toISOString(), reason };
  }
}

export interface RoadmapMap {
  readonly projectId: ProjectId; readonly projectStatus: "active" | "archived"; readonly projectRevision: number; readonly roadmapRevision: number;
  readonly nodes: readonly NodeSnapshot[]; readonly edges: readonly { readonly from: NodeId; readonly to: NodeId }[];
}
export interface CreateRoadmapInput { readonly definition: RoadmapDefinition; readonly reason: string; readonly newNodes?: readonly { readonly nodeId: NodeId; readonly input: import("../node/store.js").CreateNodeInput }[]; }
export interface RoadmapNodeDefinitionUpdate {
  readonly nodeId: NodeId;
  readonly reviewedRevision: number;
  readonly requirement: NodeRequirement;
  readonly definition: NodeDefinitionChange;
}
export interface ChangeRoadmapInput {
  readonly projectId: ProjectId;
  readonly baseRevision: number;
  readonly reason: string;
  readonly changes: readonly RoadmapChange[];
  readonly newNodes?: readonly { readonly nodeId: NodeId; readonly input: import("../node/store.js").CreateNodeInput }[];
  readonly nodeUpdates?: readonly RoadmapNodeDefinitionUpdate[];
}

function freeze<T>(value: T): T {
  const copy = structuredClone(value);
  const visit = (item: unknown): void => { if (!item || typeof item !== "object") return; Object.values(item).forEach(visit); Object.freeze(item); };
  visit(copy);
  return copy;
}

declare module "cordis" { interface Context { roadmaps: RoadmapStore; } }
