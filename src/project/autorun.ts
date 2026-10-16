import { randomUUID } from "node:crypto";

import { Service } from "cordis";
import type { Context } from "cordis";

import type { NodeId, ProjectId } from "../brand/ids.js";
import type { NodeSnapshot } from "../node/model.js";
import { ProjectError } from "./errors.js";

export interface AutoRunSnapshot {
  readonly runId: string;
  readonly projectId: ProjectId;
  readonly status: "running" | "completed" | "stopped";
  readonly nodeTurns: number;
  readonly mainTurns: number;
  readonly reason?: AutoRunStopReason;
}

export type AutoRunStopReason =
  | "roadmap-complete"
  | "no-eligible-node"
  | "review-escalated"
  | "review-undecided"
  | "turn-stopped"
  | "project-unavailable"
  | "busy"
  | "aborted";

interface RunningAutoRun {
  readonly runId: string;
  readonly controller: AbortController;
  nodeTurns: number;
  mainTurns: number;
  done: Promise<void>;
}

declare module "cordis" {
  interface Context {
    autoRun: AutoRunService;
  }
}

export class AutoRunService extends Service {
  static inject = ["projects", "nodes", "roadmaps", "reviews", "projectRuntime"];

  private readonly running = new Map<ProjectId, RunningAutoRun>();
  private unavailable = false;

  constructor(ctx: Context) {
    super(ctx, "autoRun");
    this.ctx.effect(() => async () => {
      this.unavailable = true;
      const runs = [...this.running.values()];
      for (const run of runs) run.controller.abort();
      await Promise.all(runs.map(run => run.done));
    }, "autoRun.lifecycle");
  }

  start(projectId: ProjectId): Promise<AutoRunSnapshot> {
    if (this.unavailable) throw new ProjectError("runtime-unavailable", "AutoRun is unavailable.");
    if (this.running.has(projectId)) {
      throw new ProjectError("auto-run-active", "This Project already has an active AutoRun.");
    }
    if (this.ctx.projects.get(projectId)?.status !== "active") {
      throw new ProjectError("project-unavailable", "AutoRun requires an active Project.");
    }
    if (this.ctx.projects.get(projectId)?.goal === null || this.ctx.roadmaps.get(projectId) === undefined) {
      throw new ProjectError("auto-run-unavailable", "AutoRun requires a recorded Goal and an existing Roadmap.");
    }

    const run: RunningAutoRun = {
      runId: randomUUID(),
      controller: new AbortController(),
      nodeTurns: 0,
      mainTurns: 0,
      done: Promise.resolve(),
    };
    this.running.set(projectId, run);
    const result = this.drive(projectId, run).finally(() => {
      if (this.running.get(projectId) === run) this.running.delete(projectId);
    });
    run.done = result.then(() => undefined, () => undefined);
    return result;
  }

  get(projectId: ProjectId): AutoRunSnapshot | undefined {
    const run = this.running.get(projectId);
    return run === undefined ? undefined : this.snapshot(projectId, run, "running");
  }

  private async drive(projectId: ProjectId, run: RunningAutoRun): Promise<AutoRunSnapshot> {
    const stop = (reason: AutoRunStopReason) =>
      this.snapshot(projectId, run, reason === "roadmap-complete" ? "completed" : "stopped", reason);

    while (true) {
      if (run.controller.signal.aborted) return stop("aborted");
      if (this.ctx.projects.get(projectId)?.status !== "active") return stop("project-unavailable");
      if (this.ctx.projectRuntime.isMainActive(projectId)) return stop("busy");

      const roadmap = this.ctx.roadmaps.get(projectId);
      if (roadmap === undefined) return stop("no-eligible-node");
      const nodes = roadmap.graph.topologicalOrder
        .map(nodeId => this.ctx.nodes.get(nodeId))
        .filter((node): node is NodeSnapshot => node !== undefined);
      if (nodes.some(node => node.status === "working")) return stop("busy");

      const submitted = nodes.find(node => node.status === "submitted");
      if (submitted !== undefined) {
        if (!this.ctx.reviews.isPending(submitted)) {
          return stop(submitted.lastReview?.decision === "escalate" ? "review-escalated" : "review-undecided");
        }
        const reviewed = await this.ctx.projectRuntime.startReview({
          projectId,
          nodeId: submitted.node.id,
          text: "Automatically review this Node submission against its acceptance criteria.",
          signal: run.controller.signal,
        });
        run.mainTurns += 1;
        if (reviewed.turn.status !== "completed") return stop("turn-stopped");
        const current = this.ctx.nodes.get(submitted.node.id);
        if (current?.lastReview?.reviewedRevision !== submitted.revision) {
          return stop("review-undecided");
        }
        if (current.lastReview.decision === "escalate") return stop("review-escalated");
        if (current.status === "idle" || current.status === "completing" || current.status === "skipped") continue;
        return stop("review-undecided");
      }

      const eligible = nodes.find(node => node.status === "idle");
      if (eligible === undefined) {
        return stop(nodes.every(node => node.status === "completing" || node.status === "skipped")
          ? "roadmap-complete" : "no-eligible-node");
      }
      if (this.ctx.projectRuntime.isNodeActive(eligible.node.id)) return stop("busy");
      const turn = eligible.sessionId === undefined
        ? await this.ctx.projectRuntime.startNode({
          projectId,
          nodeId: eligible.node.id,
          text: "Start working on this Node objective and its acceptance criteria.",
          signal: run.controller.signal,
        })
        : await this.ctx.projectRuntime.continueNode({
          projectId,
          nodeId: eligible.node.id,
          text: "Continue working on this Node until you are ready to submit_completion.",
          signal: run.controller.signal,
        });
      run.nodeTurns += 1;
      if (turn.turn.status !== "completed") return stop("turn-stopped");
    }
  }

  private snapshot(
    projectId: ProjectId,
    run: RunningAutoRun,
    status: AutoRunSnapshot["status"],
    reason?: AutoRunStopReason,
  ): AutoRunSnapshot {
    return Object.freeze({
      runId: run.runId,
      projectId,
      status,
      nodeTurns: run.nodeTurns,
      mainTurns: run.mainTurns,
      ...(reason === undefined ? {} : { reason }),
    });
  }
}
