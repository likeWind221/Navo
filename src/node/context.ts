import type { Context } from "cordis";

import type { ResourceId } from "../brand/ids.js";
import type { NodeObjective, NodeSnapshot, NodeStatus } from "./model.js";
import { NodeError } from "./errors.js";

export interface NodeTurnContext {
  readonly projectGoal: string;
  readonly objective: NodeObjective;
  readonly status: NodeStatus;
  readonly resources: readonly NodeTurnResourceContext[];
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

  build(snapshot: NodeSnapshot): NodeTurnContext {
    if (snapshot.node.kind !== "work") {
      throw new NodeError(
        "invalid-state",
        "Control nodes cannot build a Node Agent Turn context.",
      );
    }

    const project = this.ctx.projects.get(snapshot.node.projectId);
    if (project === undefined || project.status !== "active") {
      throw new NodeError(
        "project-unavailable",
        "Node Turn context requires an active owning Project.",
      );
    }

    const resources = this.ctx.resources.listVisible(
      project.id,
      { kind: "node", nodeId: snapshot.node.id },
    ).map(resource => Object.freeze({
      id: resource.id,
      name: resource.name,
      description: resource.description,
      type: resource.type,
      revision: resource.revision,
      ownedByCurrentAgent: resource.owner.kind === "node"
        && resource.owner.nodeId === snapshot.node.id,
    }));

    return Object.freeze({
      projectGoal: project.goal,
      objective: Object.freeze(structuredClone(snapshot.node.objective)),
      status: snapshot.status,
      resources: Object.freeze(resources),
    });
  }
}
