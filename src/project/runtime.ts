import { Service } from "cordis";
import type { Context } from "cordis";

import type { NodeId, ProjectId } from "../brand/ids.js";
import { NodeError } from "../node/errors.js";
import type { NodeConfirmation, NodeSnapshot } from "../node/model.js";
import type {
  NodeSessionTurnResult,
} from "../node/session.js";
import { ProjectError } from "./errors.js";
import type { MainSessionMessageInput, MainSessionTurnResult } from "./session.js";

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

export class ProjectRuntime extends Service {
  static inject = ["projects", "nodes", "roadmaps", "nodeSessions", "mainSessions"];

  private readonly activeNodes = new Map<NodeId, AbortController>();
  private readonly activeMains = new Map<ProjectId, AbortController>();
  private unavailable = false;

  constructor(ctx: Context) {
    super(ctx, "projectRuntime");
    this.ctx.effect(() => () => {
      this.unavailable = true;
      for (const controller of this.activeMains.values()) controller.abort();
      for (const controller of this.activeNodes.values()) controller.abort();
    }, "projectRuntime.lifecycle");
  }

  canStartMain(projectId: ProjectId): boolean {
    return !this.unavailable && !this.activeMains.has(projectId)
      && this.ctx.projects.get(projectId)?.status === "active";
  }

  startMain(input: MainSessionMessageInput): Promise<MainSessionTurnResult> {
    this.requireActiveProject(input.projectId);
    if (this.activeMains.has(input.projectId)) {
      throw new ProjectError("turn-active", "Main already has a Human-started Turn in progress.");
    }
    return this.runReserved(this.activeMains, input.projectId, input.signal,
      signal => this.ctx.mainSessions.sendMessage({ ...input, signal }));
  }

  stopMain(projectId: ProjectId): boolean {
    this.requireProject(projectId);
    return this.abort(this.activeMains.get(projectId));
  }

  canStartNode(projectId: ProjectId, nodeId: NodeId): boolean {
    return this.canRunNode(projectId, nodeId)
      && this.ctx.nodes.get(nodeId)?.sessionId === undefined;
  }

  canContinueNode(projectId: ProjectId, nodeId: NodeId): boolean {
    return this.canRunNode(projectId, nodeId)
      && this.ctx.nodes.get(nodeId)?.sessionId !== undefined;
  }

  private canRunNode(projectId: ProjectId, nodeId: NodeId): boolean {
    if (this.unavailable || this.activeNodes.has(nodeId)) return false;

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
    const node = this.requireStartableNode(input.projectId, input.nodeId);
    if (node.sessionId !== undefined) {
      throw new NodeError("node-already-bound", "Use continueNode for an existing Node Session.");
    }
    return this.runReserved(this.activeNodes, input.nodeId, input.signal,
      signal => this.ctx.nodeSessions.start({ nodeId: input.nodeId, text: input.text, signal }));
  }

  continueNode(input: ProjectNodeTurnInput): Promise<NodeSessionTurnResult> {
    this.requireStartableNode(input.projectId, input.nodeId);
    return this.runReserved(this.activeNodes, input.nodeId, input.signal,
      signal => this.ctx.nodeSessions.sendMessage({ nodeId: input.nodeId, text: input.text, signal }));
  }

  stopNode(projectId: ProjectId, nodeId: NodeId): boolean {
    this.requireProjectNode(projectId, nodeId);
    return this.abort(this.activeNodes.get(nodeId));
  }

  confirmCompletion(projectId: ProjectId, nodeId: NodeId, confirmation: NodeConfirmation): NodeSnapshot {
    this.requireReviewableNode(projectId, nodeId);
    return this.ctx.nodes.confirmCompletion(nodeId, confirmation);
  }

  skipNode(projectId: ProjectId, nodeId: NodeId, confirmation: NodeConfirmation): NodeSnapshot {
    this.requireReviewableNode(projectId, nodeId);
    return this.ctx.nodes.skip(nodeId, confirmation);
  }

  private requireReviewableNode(projectId: ProjectId, nodeId: NodeId): void {
    this.requireActiveProject(projectId);
    this.requireProjectNode(projectId, nodeId);
    this.requireNodeAvailable(nodeId);
  }

  private requireNodeAvailable(nodeId: NodeId): void {
    if (this.activeNodes.has(nodeId)) {
      throw new NodeError(
        "invalid-state",
        "Node already has a Human-started Turn in progress.",
      );
    }
  }

  private async runReserved<K, T>(
    active: Map<K, AbortController>, key: K, callerSignal: AbortSignal | undefined,
    run: (signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const signal = callerSignal === undefined
      ? controller.signal : AbortSignal.any([callerSignal, controller.signal]);
    active.set(key, controller);
    try {
      return await run(signal);
    } finally {
      active.delete(key);
    }
  }

  private abort(controller: AbortController | undefined): boolean {
    if (controller === undefined || controller.signal.aborted) return false;
    controller.abort();
    return true;
  }

  private requireProject(projectId: ProjectId) {
    const project = this.ctx.projects.get(projectId);
    if (project === undefined) {
      throw new ProjectError("project-not-found", "Project was not found.");
    }
    return project;
  }

  private requireActiveProject(projectId: ProjectId): void {
    if (this.unavailable) {
      throw new ProjectError("runtime-unavailable", "ProjectRuntime was disposed.");
    }
    if (this.requireProject(projectId).status !== "active") {
      throw new ProjectError(
        "project-unavailable",
        "Human control requires an active Project.",
      );
    }
  }

  private requireProjectNode(projectId: ProjectId, nodeId: NodeId): NodeSnapshot {
    this.requireProject(projectId);
    const node = this.ctx.nodes.get(nodeId);
    if (node === undefined || node.node.projectId !== projectId) {
      throw new NodeError(
        "node-not-found",
        "Node was not found in the requested Project.",
      );
    }
    return node;
  }

  private requireStartableNode(projectId: ProjectId, nodeId: NodeId): NodeSnapshot {
    this.requireActiveProject(projectId);
    const node = this.requireProjectNode(projectId, nodeId);
    this.requireNodeAvailable(nodeId);
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
    return node;
  }
}
