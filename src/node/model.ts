import type { NodeId, ProjectId, ResourceId, SessionId, TurnId } from "../brand/ids.js";

export interface NodeSnapshot {
  readonly node: Node;
  readonly revision: number;
  readonly status: NodeStatus;
  readonly sessionId?: SessionId;
  readonly confirmation?: NodeConfirmation;
  readonly submission?: NodeSubmission;
  readonly pendingFeedback?: NodeFeedback;
  readonly lastReview?: NodeReview;
  readonly reworkCount?: number;
}

export type Node = NodeIdentity & (
  | { readonly kind: "work"; readonly objective: NodeObjective }
  | { readonly kind: "control"; readonly purpose: ControlPurpose; readonly title: string }
);

export type ControlPurpose = "start" | "end" | "checkpoint";

interface NodeIdentity {
  readonly id: NodeId;
  readonly projectId: ProjectId;
  readonly requirement: NodeRequirement;
}

export type NodeRequirement = "required" | "optional";
export type NodeStatus = "locked" | "idle" | "working" | "submitted" | "completing" | "skipped";

export interface NodeObjective {
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: readonly string[];
}

export interface NodeConfirmation {
  readonly confirmedBy: string;
  readonly reason: string;
  readonly reviewedRevision: number;
}

export interface NodeSubmission extends NodeSubmissionInput {
  readonly submittedAt: string;
}

export interface NodeSubmissionInput {
  readonly summary: string;
  readonly resourceIds: readonly ResourceId[];
  readonly criteria: readonly NodeCriterionCheck[];
  readonly remaining: readonly string[];
}

export interface NodeCriterionCheck {
  readonly criterion: string;
  readonly satisfied: boolean;
  readonly note: string;
}

export interface NodeFeedback extends NodeReworkInput {
  readonly requestedAt: string;
}

export interface NodeReworkInput {
  readonly requestedBy: string;
  readonly feedback: string;
  readonly reviewedRevision: number;
}

export type ReviewDecision = "complete" | "rework" | "skip" | "escalate";

export interface NodeReviewInput {
  readonly turnId?: TurnId;
  readonly decision: ReviewDecision;
  readonly reason: string;
  readonly reviewedRevision: number;
}

export interface NodeReview extends NodeReviewInput {
  readonly reviewedAt: string;
}
