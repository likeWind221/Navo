import type { NodeId, ProjectId, SessionId } from "../brand/ids.js";

export interface NodeSnapshot {
  readonly node: Node;
  readonly revision: number;
  readonly status: NodeStatus;
  readonly sessionId?: SessionId;
  readonly confirmation?: NodeConfirmation;
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
export type NodeStatus = "locked" | "idle" | "working" | "completing" | "skipped";

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
