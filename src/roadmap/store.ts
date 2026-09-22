import { randomUUID } from "node:crypto";
import { Service } from "cordis";
import type { Context } from "cordis";
import { createEventId } from "../brand/ids.js";
import type { NodeId, ProjectId } from "../brand/ids.js";
import type { NodeDefinitionChange, NodeEventDraft } from "../node/events.js";
import type { NodeRequirement, NodeSnapshot } from "../node/model.js";
import type { NodeStore } from "../node/store.js";
import { buildRoadmapGraph } from "./graph.js";
import { RoadmapError } from "./errors.js";
import { freezeRoadmapEvent } from "./events.js";
import type { RoadmapChange, RoadmapEvent } from "./events.js";
import type { RoadmapDefinition, RoadmapGraph, RoadmapSnapshot } from "./model.js";
import { projectRoadmap } from "./projector.js";

export class RoadmapStore extends Service {
  static inject = ["projects", "nodes"];
  private readonly histories = new Map<ProjectId, readonly RoadmapEvent[]>();
  private readonly snapshots = new Map<ProjectId, RoadmapSnapshot>();

  constructor(ctx: Context) {
    super(ctx, "roadmaps");
    const nodes = this.ctx.nodes;
    nodes.coordinate(drafts => this.commitNodeAction(nodes, drafts));
  }

  create(input: CreateRoadmapInput): RoadmapSnapshot {
    const projectId = input.definition.projectId;
    if (this.snapshots.has(projectId)) throw new RoadmapError("already-exists", "Project already owns a roadmap");
    if (this.ctx.projects.get(projectId)?.status !== "active") throw new RoadmapError("project-unavailable", "Creating a roadmap requires an active project");
    const nodeEvents = (input.newNodes ?? []).map(value => this.ctx.nodes.creation(value));
    const nodeBatch = this.ctx.nodes.prepare(nodeEvents);
    const catalog = [...this.ctx.nodes.getByProject(projectId).map(value => value.node), ...nodeEvents.map(event => nodeBatch.get(event.nodeId)!.node)];
    const event = freezeRoadmapEvent({ ...this.header(projectId, 0, input.reason), type: "roadmap-created", definition: input.definition });
    const snapshot = projectRoadmap(projectId, [event], catalog);
    if (!snapshot) throw new RoadmapError("invalid-event-stream", "Invalid roadmap event");
    this.ctx.nodes.commit(nodeBatch);
    this.commitHistory(projectId, Object.freeze([event]), snapshot);
    this.unlockReady(projectId);
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
      if (currentNode.status !== "working") continue;
      const relation = snapshot.graph.relations.find(value => value.nodeId === currentNode.node.id);
      if (!relation || !relation.requiredBefore.every(required => this.isTerminal(candidateNodes.get(required)))) {
        throw new RoadmapError("working-node", "Roadmap change would invalidate a working Node");
      }
    }
    for (const relation of snapshot.graph.relations) {
      const currentNode = currentNodes.get(relation.nodeId);
      if (currentNode?.status === "idle" && !relation.requiredBefore.every(required => this.isTerminal(candidateNodes.get(required)))) {
        batch.add({ type: "node-locked", nodeId: relation.nodeId, data: { reason: "Roadmap dependencies changed" } });
      }
    }

    this.ctx.nodes.commit(batch);
    this.commitHistory(input.projectId, history, snapshot);
    this.unlockReady(input.projectId);
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
    if (this.snapshots.has(projectId)) throw new RoadmapError("already-exists", "Cannot overwrite an existing roadmap");
    const history = Object.freeze(events.map(freezeRoadmapEvent));
    const snapshot = projectRoadmap(projectId, history, this.ctx.nodes.getByProject(projectId).map(value => value.node));
    if (!snapshot) throw new RoadmapError("invalid-event-stream", "Cannot restore an empty history");
    this.commitHistory(projectId, history, snapshot);
    return snapshot;
  }

  private commitHistory(projectId: ProjectId, history: readonly RoadmapEvent[], snapshot: RoadmapSnapshot): void {
    this.histories.set(projectId, history);
    this.snapshots.set(projectId, snapshot);
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

  private unlockReady(projectId: ProjectId): void {
    const roadmap = this.get(projectId);
    if (!roadmap) return;
    const proposed = new Map(this.ctx.nodes.getByProject(projectId).map(value => [value.node.id, value]));
    const graph = buildRoadmapGraph(roadmap.graph.definition, [...proposed.values()].map(value => value.node));
    const ids = this.findUnlocks(graph, proposed);
    if (ids.length === 0) return;
    const batch = this.ctx.nodes.prepare(ids.map(id => ({ type: "node-unlocked" as const, nodeId: id, data: { reason: "Required dependencies resolved" } })));
    this.ctx.nodes.commit(batch);
  }

  private findUnlocks(graph: RoadmapGraph, nodes: Map<NodeId, NodeSnapshot>, batch?: import("../node/batch.js").NodeBatch, added = new Set<NodeId>()): NodeId[] {
    const result: NodeId[] = [];
    for (const id of graph.topologicalOrder) {
      const snapshot = nodes.get(id);
      const relation = graph.relations.find(value => value.nodeId === id)!;
      if (!snapshot || snapshot.status !== "locked") continue;
      if (!relation.requiredBefore.every(required => this.isTerminal(nodes.get(required)))) continue;
      result.push(id);
      if (batch && !added.has(id)) {
        batch.add({ type: "node-unlocked", nodeId: id, data: { reason: "Required dependencies resolved" } });
        nodes.set(id, batch.get(id)!);
        added.add(id);
      }
    }
    return result;
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
