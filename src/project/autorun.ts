import { randomUUID } from "node:crypto";

import { Service } from "cordis";
import type { Context } from "cordis";

import type { ProjectId } from "../brand/ids.js";
import type { TurnResult } from "../agent/types.js";
import type { NodeSnapshot } from "../node/model.js";
import type { NodeSessionTurnResult } from "../node/session.js";
import { ProjectError } from "./errors.js";
import type { MainSessionTurnResult } from "./session.js";

export const DEFAULT_NODE_TURN_LIMIT = 64;
export const DEFAULT_MAIN_TURN_LIMIT = 32;

export interface AutoRunSnapshot {
  readonly runId: string;
  readonly projectId: ProjectId;
  readonly status: "running" | "paused" | "completed";
  readonly nodeTurns: number;
  readonly mainTurns: number;
  readonly reason?: AutoRunStopReason;
}

export type AutoRunStopReason =
  | "roadmap-complete"
  | "no-eligible-node"
  | "review-escalated"
  | "review-undecided"
  | "turn-failed"
  | "turn-cancelled"
  | "turn-interrupted"
  | "turn-blocked"
  | "node-turn-limit"
  | "main-turn-limit"
  | "human-paused"
  | "project-unavailable"
  | "busy"
  | "aborted";

interface AutoRunLimits {
  readonly nodeTurns: number;
  readonly mainTurns: number;
}

interface AutoRunRun {
  readonly runId: string;
  readonly limits: AutoRunLimits;
  controller: AbortController;
  status: "running" | "paused";
  reason?: AutoRunStopReason;
  pauseRequested: boolean;
  turnActive: boolean;
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

  private readonly runs = new Map<ProjectId, AutoRunRun>();
  private unavailable = false;

  constructor(ctx: Context) {
    super(ctx, "autoRun");
    this.ctx.effect(() => async () => {
      this.unavailable = true;
      const runs = [...this.runs.values()];
      for (const run of runs) run.controller.abort();
      await Promise.all(runs.map(run => run.done));
      this.runs.clear();
    }, "autoRun.lifecycle");
  }

  start(projectId: ProjectId): Promise<AutoRunSnapshot> {
    if (this.unavailable) throw new ProjectError("runtime-unavailable", "AutoRun is unavailable.");
    if (this.runs.has(projectId)) {
      throw new ProjectError("auto-run-active", "This Project already has an AutoRun; resume it instead of starting another.");
    }
    this.requireRunnableProject(projectId);

    const run = this.createRun();
    this.runs.set(projectId, run);
    return this.run(projectId, run);
  }

  pause(projectId: ProjectId): AutoRunSnapshot {
    const run = this.requireRun(projectId);
    if (run.status === "paused") return this.snapshot(projectId, run);

    run.pauseRequested = true;
    if (!run.turnActive) {
      run.status = "paused";
      run.reason = "human-paused";
      run.pauseRequested = false;
    }
    return this.snapshot(projectId, run);
  }

  resume(projectId: ProjectId): Promise<AutoRunSnapshot> {
    if (this.unavailable) throw new ProjectError("runtime-unavailable", "AutoRun is unavailable.");
    const previous = this.requireRun(projectId);
    if (previous.status !== "paused") {
      throw new ProjectError("auto-run-not-paused", "This Project does not have a paused AutoRun.");
    }
    this.requireRunnableProject(projectId);

    // F11.0 defines the budget per continuous AutoRun. Resume starts a new
    // continuous run from the current Project state, so its budget is fresh.
    const run = this.createRun();
    this.runs.set(projectId, run);
    return this.run(projectId, run);
  }

  get(projectId: ProjectId): AutoRunSnapshot | undefined {
    const run = this.runs.get(projectId);
    return run === undefined ? undefined : this.snapshot(projectId, run);
  }

  private createRun(): AutoRunRun {
    return {
      runId: randomUUID(),
      limits: {
        nodeTurns: DEFAULT_NODE_TURN_LIMIT,
        mainTurns: DEFAULT_MAIN_TURN_LIMIT,
      },
      controller: new AbortController(),
      status: "running",
      pauseRequested: false,
      turnActive: false,
      nodeTurns: 0,
      mainTurns: 0,
      done: Promise.resolve(),
    };
  }

  private requireRun(projectId: ProjectId): AutoRunRun {
    const run = this.runs.get(projectId);
    if (run === undefined) {
      throw new ProjectError("auto-run-not-found", "This Project has no AutoRun to control.");
    }
    return run;
  }

  private requireRunnableProject(projectId: ProjectId): void {
    if (this.ctx.projects.get(projectId)?.status !== "active") {
      throw new ProjectError("project-unavailable", "AutoRun requires an active Project.");
    }
    if (this.ctx.projects.get(projectId)?.goal === null || this.ctx.roadmaps.get(projectId) === undefined) {
      throw new ProjectError("auto-run-unavailable", "AutoRun requires a recorded Goal and an existing Roadmap.");
    }
  }

  private run(projectId: ProjectId, run: AutoRunRun): Promise<AutoRunSnapshot> {
    const promise = this.drive(projectId, run);
    run.done = promise.then(() => undefined, () => undefined);
    void promise.then(snapshot => {
      if (snapshot.status === "completed" && this.runs.get(projectId) === run) {
        this.runs.delete(projectId);
      }
    });
    return promise;
  }

  private async drive(projectId: ProjectId, run: AutoRunRun): Promise<AutoRunSnapshot> {
    const stop = (reason: AutoRunStopReason) => {
      run.status = reason === "roadmap-complete" ? "completed" : "paused";
      run.reason = reason;
      run.pauseRequested = false;
      return this.snapshot(projectId, run);
    };

    try {
      while (true) {
        if (run.controller.signal.aborted) return stop("aborted");
        if (run.status !== "running") return this.snapshot(projectId, run);
        if (run.pauseRequested) return stop("human-paused");
        if (run.nodeTurns >= run.limits.nodeTurns) return stop("node-turn-limit");
        if (run.mainTurns >= run.limits.mainTurns) return stop("main-turn-limit");
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
          if (run.mainTurns >= run.limits.mainTurns) return stop("main-turn-limit");

          run.turnActive = true;
          let reviewed: MainSessionTurnResult;
          try {
            reviewed = await this.ctx.projectRuntime.startReview({
              projectId,
              nodeId: submitted.node.id,
              text: "Automatically review this Node submission against its acceptance criteria.",
              signal: run.controller.signal,
            });
          } finally {
            run.turnActive = false;
          }
          run.mainTurns += 1;

          const stopReason = this.turnStopReason(reviewed.turn);
          if (stopReason !== undefined) return stop(stopReason);
          if (run.pauseRequested) return stop("human-paused");
          if (run.mainTurns >= run.limits.mainTurns) return stop("main-turn-limit");

          const current = this.ctx.nodes.get(submitted.node.id);
          const decision = current?.lastReview;
          if (decision === undefined || decision.reviewedRevision !== submitted.revision) {
            return stop("review-undecided");
          }
          if (decision.decision === "escalate") return stop("review-escalated");
          if (current?.status === "idle" || current?.status === "completing" || current?.status === "skipped") continue;
          return stop("review-undecided");
        }

        const eligible = nodes.find(node => node.status === "idle");
        if (eligible === undefined) {
          return stop(nodes.every(node => node.status === "completing" || node.status === "skipped")
            ? "roadmap-complete" : "no-eligible-node");
        }
        if (this.ctx.projectRuntime.isNodeActive(eligible.node.id)) return stop("busy");
        if (run.nodeTurns >= run.limits.nodeTurns) return stop("node-turn-limit");

        run.turnActive = true;
        let turn: NodeSessionTurnResult;
        try {
          turn = eligible.sessionId === undefined
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
        } finally {
          run.turnActive = false;
        }
        run.nodeTurns += 1;

        const stopReason = this.turnStopReason(turn.turn);
        if (stopReason !== undefined) return stop(stopReason);
        if (run.pauseRequested) return stop("human-paused");
        if (run.nodeTurns >= run.limits.nodeTurns) return stop("node-turn-limit");
      }
    } catch (error) {
      if (run.controller.signal.aborted) return stop("aborted");
      return stop("turn-failed");
    }
  }

  private turnStopReason(turn: TurnResult): AutoRunStopReason | undefined {
    switch (turn.status) {
      case "completed":
        return undefined;
      case "cancelled":
        return "turn-cancelled";
      case "blocked":
        return "turn-blocked";
      case "failed":
        return turn.failure.code === "interrupted" ? "turn-interrupted" : "turn-failed";
    }
  }

  private snapshot(
    projectId: ProjectId,
    run: AutoRunRun,
  ): AutoRunSnapshot {
    return Object.freeze({
      runId: run.runId,
      projectId,
      status: run.status,
      nodeTurns: run.nodeTurns,
      mainTurns: run.mainTurns,
      ...(run.reason === undefined ? {} : { reason: run.reason }),
    });
  }
}
