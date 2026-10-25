import type { Context } from "cordis";

import { visibleResourceContext } from "../resource/context.js";

import type { ResourceId } from "../brand/ids.js";
import { changedFacts } from "../session/reminder.js";
import type { ContextFact } from "../session/types.js";
import type { NodeFeedback, NodeObjective, NodeSnapshot, NodeStatus } from "./model.js";
import { NodeError } from "./errors.js";

export interface NodeTurnContext {
  readonly projectGoal: string | null;
  readonly objective: NodeObjective;
  readonly status: NodeStatus;
  readonly reworkFeedback?: NodeFeedback;
  readonly resources: readonly NodeTurnResourceContext[];
  readonly addedResources: readonly NodeTurnResourceContext[];
  readonly facts: readonly ContextFact[];
}

export interface NodeTurnResourceContext {
  readonly id: ResourceId;
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly revision: number;
  readonly ownedByCurrentAgent: boolean;
}

export class NodeTurnContextBuilder {
  constructor(private readonly ctx: Context) {}

  build(
    snapshot: NodeSnapshot,
    observed?: readonly ContextFact[],
  ): NodeTurnContext {

    const project = this.ctx.projects.get(snapshot.node.projectId);
    if (project === undefined || project.status !== "active") {
      throw new NodeError(
        "project-unavailable",
        "Node Turn context requires an active owning Project.",
      );
    }

    const resources = visibleResourceContext(this.ctx, project.id, { kind: "node", nodeId: snapshot.node.id });

    const facts = resources
      .filter(resource => !resource.ownedByCurrentAgent)
      .map(resource => Object.freeze({ kind: "resource", id: String(resource.id), label: resource.name }));
    const added = new Set(changedFacts(observed, facts)
      .filter(change => change.previous === undefined)
      .map(change => change.fact.id));

    const rework = this.ctx.nodes.getEvents(snapshot.node.id).findLast(event =>
      event.type === "rework-requested" || event.type === "completion-signaled"
      || event.type === "completion-confirmed" || event.type === "node-skipped");
    return Object.freeze({
      ...(rework?.type === "rework-requested"
        ? { reworkFeedback: { ...rework.data, requestedAt: rework.timestamp } } : {}),
      projectGoal: project.goal,
      objective: Object.freeze(structuredClone(snapshot.node.objective)),
      status: snapshot.status,
      resources: Object.freeze(resources),
      addedResources: Object.freeze(resources.filter(resource => added.has(String(resource.id)))),
      facts: Object.freeze(facts),
    });
  }
}
