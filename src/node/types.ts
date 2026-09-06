import type { NodeId, SessionId } from "../brand/ids.js";
import type { NodeContentSnapshot, SourceReference } from "./content.js";

export type { SourceReference } from "./content.js";

/** Current Node state reconstructed from its complete committed history. */
export interface NodeSnapshot {
  readonly node: Node;
  readonly revision: number;
  readonly content: NodeContentSnapshot;
  readonly sessionId?: SessionId;
}

/** A verifiable capability unit with one separately bound conversation Session. */
export interface Node {
  readonly id: NodeId;
  readonly capability: CapabilityTarget;
  readonly sources: readonly SourceReference[];
}

/** What the learner must demonstrably be able to do. */
export interface CapabilityTarget {
  readonly title: string;
  readonly description: string;
  readonly successCriteria: readonly string[];
}
