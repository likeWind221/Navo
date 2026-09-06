import type { EventId, NodeId, SessionId } from "../brand/ids.js";
import type { ExerciseSet, MaterialDocument } from "./content.js";
import type { CapabilityTarget, SourceReference } from "./types.js";

/** Every committed fact in one Node's current domain history. */
export type NodeEvent =
  | NodeCreatedEvent
  | SessionBoundEvent
  | MaterialReplacedEvent
  | ExerciseSetReplacedEvent;

/** A committed, ordered fact scoped to one Node. */
export interface NodeEventRecord<TType extends string, TData> {
  readonly id: EventId;
  readonly nodeId: NodeId;
  readonly revision: number;
  /** ISO 8601 timestamp. */
  readonly timestamp: string;
  readonly type: TType;
  readonly data: TData;
}

export type NodeCreatedEvent = NodeEventRecord<
  "node-created",
  {
    readonly capability: CapabilityTarget;
    readonly sources: readonly SourceReference[];
  }
>;

/** Binds the Node's sole conversational Session without copying its log. */
export type SessionBoundEvent = NodeEventRecord<
  "session-bound",
  { readonly sessionId: SessionId }
>;

export type MaterialReplacedEvent = NodeEventRecord<
  "material-replaced",
  { readonly material: MaterialDocument }
>;

export type ExerciseSetReplacedEvent = NodeEventRecord<
  "exercise-set-replaced",
  { readonly exerciseSet: ExerciseSet }
>;
