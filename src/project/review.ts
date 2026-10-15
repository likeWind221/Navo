import { Service } from "cordis";
import type { Context } from "cordis";

import type { NodeId, ProjectId } from "../brand/ids.js";
import { NodeError } from "../node/errors.js";
import type { NodeSnapshot, ReviewDecision } from "../node/model.js";
import { buildChecklist, lastEndedTurn } from "./checklist.js";
import type { NodeTurnRecord } from "./checklist.js";
import { ProjectError } from "./errors.js";

export const MAIN_REWORK_LIMIT = 2;

export interface ReviewDecisionInput {
  readonly decision: ReviewDecision;
  readonly reason: string;
  readonly feedback?: string;
}

export interface ActiveReview {
  readonly nodeId: NodeId;
  readonly revision: number;
  readonly turn: NodeTurnRecord | undefined;
  decided: boolean;
}

declare module "cordis" {
  interface Context {
    reviews: ReviewService;
  }
}

export class ReviewService extends Service {
  static inject = ["projects", "nodes", "sessions", "resources", "mailbox"];

  private readonly active = new Map<ProjectId, ActiveReview>();

  constructor(ctx: Context) {
    super(ctx, "reviews");
  }

  requireReviewable(projectId: ProjectId, nodeId: NodeId): NodeSnapshot {
    const node = this.ctx.nodes.get(nodeId);
    if (node === undefined || node.node.projectId !== projectId) {
      throw new NodeError("node-not-found", "Node was not found in the requested Project.");
    }
    if (node.node.kind !== "work") {
      throw new NodeError("invalid-state", "Control nodes have no Turn to review.");
    }
    if (node.status !== "idle" && node.status !== "submitted") {
      throw new NodeError("invalid-state", `Node is ${node.status}; review requires idle or submitted.`);
    }
    return node;
  }

  begin(projectId: ProjectId, nodeId: NodeId): string {
    if (this.active.has(projectId)) {
      throw new ProjectError("turn-active", "A Main review is already in progress for this Project.");
    }
    const node = this.requireReviewable(projectId, nodeId);
    const turn = this.lastTurn(node);
    const checklist = buildChecklist(this.ctx, node, turn, reworkBudget(node));
    this.active.set(projectId, { nodeId, revision: node.revision, turn, decided: false });
    return checklist;
  }

  end(projectId: ProjectId): void {
    this.active.delete(projectId);
  }

  get(projectId: ProjectId): ActiveReview | undefined {
    return this.active.get(projectId);
  }

  activeNodeId(projectId: ProjectId): NodeId | undefined {
    return this.active.get(projectId)?.nodeId;
  }

  isPending(node: NodeSnapshot): boolean {
    if (node.node.kind !== "work" || (node.status !== "idle" && node.status !== "submitted")) return false;
    const turn = this.lastTurn(node);
    return turn !== undefined && node.lastReview?.turnId !== turn.turnId;
  }

  submit(projectId: ProjectId, input: ReviewDecisionInput): NodeSnapshot {
    const review = this.active.get(projectId);
    if (review === undefined) throw new NodeError("invalid-state", "No Main review is in progress.");
    if (review.decided) throw new NodeError("invalid-state", "This review already has a decision.");
    const node = this.ctx.nodes.get(review.nodeId);
    if (node === undefined) throw new NodeError("node-not-found", "Reviewed Node no longer exists.");
    if (node.revision !== review.revision) {
      throw new NodeError("stale-revision", "The reviewed Node changed during this review; the decision was not recorded.");
    }
    if (input.reason.trim() === "") throw new NodeError("invalid-message", "A review decision requires a reason.");
    if (input.decision === "rework") {
      if (input.feedback === undefined || input.feedback.trim() === "") {
        throw new NodeError("invalid-message", "Rework requires feedback telling the Node what to fix.");
      }
      if (reworkBudget(node).remaining === 0) {
        throw new NodeError("invalid-state", `This Node was already returned ${MAIN_REWORK_LIMIT} times; escalate to Human instead.`);
      }
    }
    if (input.decision === "complete" && review.turn === undefined) {
      throw new NodeError("invalid-state", "A Node that never ran cannot be confirmed complete by Main.");
    }
    const recorded = this.ctx.nodes.recordReview(
      review.nodeId,
      {
        ...(review.turn === undefined ? {} : { turnId: review.turn.turnId }),
        decision: input.decision,
        reason: input.reason,
        reviewedRevision: review.revision,
      },
      input.feedback,
    );
    review.decided = true;
    return recorded;
  }

  private lastTurn(node: NodeSnapshot): NodeTurnRecord | undefined {
    return node.sessionId === undefined ? undefined : lastEndedTurn(this.ctx.sessions.getEvents(node.sessionId));
  }
}

function reworkBudget(node: NodeSnapshot): { readonly used: number; readonly remaining: number } {
  const used = node.reworkCount ?? 0;
  return { used, remaining: Math.max(0, MAIN_REWORK_LIMIT - used) };
}
