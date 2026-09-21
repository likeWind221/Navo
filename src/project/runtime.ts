import { Service } from "cordis";
import type { Context } from "cordis";

import type { NodeId, ProjectId } from "../brand/ids.js";
import { NodeError } from "../node/errors.js";
import type {
  NodeSessionTurnResult,
} from "../node/session.js";
import { ProjectError } from "./errors.js";

export interface ProjectNodeTurnInput {
  readonly projectId: ProjectId;
  readonly nodeId: NodeId;
  readonly text: string;
  readonly signal?: AbortSignal;
}

declare module "cordis" {
  interface Context {
    projectRuntime: ProjectRuntime;
  }
}

/**
 * Human-controlled Project execution boundary.
 *
 * This service does not own a second execution state machine. Node status remains
 * authoritative in NodeStore; the local reservation only closes the synchronous
 * double-start window before NodeSessionService records work-started.
 */
export class ProjectRuntime extends Service {
  static inject = ["projects", "nodes", "roadmaps", "nodeSessions"];

  private readonly startingNodes = new Set<NodeId>();

  constructor(ctx: Context) {
    super(ctx, "projectRuntime");
  }

  canStartNode(projectId: ProjectId, nodeId: NodeId): boolean {
    if (this.startingNodes.has(nodeId)) return false;

    const project = this.ctx.projects.get(projectId);
    if (project === undefined || project.status !== "active") return false;

    const node = this.ctx.nodes.get(nodeId);
    if (
      node === undefined
      || node.node.projectId !== projectId
      || node.node.kind !== "work"
      || node.status !== "idle"
    ) {
      return false;
    }

    const roadmap = this.ctx.roadmaps.get(projectId);
    return roadmap === undefined
      || roadmap.graph.definition.nodes.includes(nodeId);
  }

  startNode(input: ProjectNodeTurnInput): Promise<NodeSessionTurnResult> {
    this.requireStartableNode(input.projectId, input.nodeId);

    if (this.startingNodes.has(input.nodeId)) {
      throw new NodeError(
        "invalid-state",
        "Node already has a Human-started Turn in progress.",
      );
    }

    this.startingNodes.add(input.nodeId);
    try {
      const turn = this.ctx.nodeSessions.start(
        input.signal === undefined
          ? { nodeId: input.nodeId, text: input.text }
          : { nodeId: input.nodeId, text: input.text, signal: input.signal },
      );
      return turn.finally(() => {
        this.startingNodes.delete(input.nodeId);
      });
    } catch (error: unknown) {
      this.startingNodes.delete(input.nodeId);
      throw error;
    }
  }

  private requireStartableNode(projectId: ProjectId, nodeId: NodeId): void {
    const project = this.ctx.projects.get(projectId);
    if (project === undefined) {
      throw new ProjectError("project-not-found", "Project was not found.");
    }
    if (project.status !== "active") {
      throw new ProjectError(
        "project-unavailable",
        "Node execution requires an active Project.",
      );
    }

    const node = this.ctx.nodes.get(nodeId);
    if (node === undefined || node.node.projectId !== projectId) {
      throw new NodeError(
        "node-not-found",
        "Node was not found in the requested Project.",
      );
    }
    if (node.node.kind !== "work") {
      throw new NodeError("invalid-state", "Control nodes cannot execute.");
    }
    if (node.status !== "idle") {
      throw new NodeError(
        "invalid-state",
        `Node is ${node.status}; Human start requires idle.`,
      );
    }

    const roadmap = this.ctx.roadmaps.get(projectId);
    if (
      roadmap !== undefined
      && !roadmap.graph.definition.nodes.includes(nodeId)
    ) {
      throw new NodeError(
        "invalid-state",
        "Node is not part of the current Project Roadmap.",
      );
    }
  }
}
