import type { EventId, NodeId, ProjectId, SessionId } from "../brand/ids.js";
import type { ControlPurpose, NodeConfirmation, NodeObjective, NodeRequirement } from "./model.js";

export type NodeDefinitionChange =
  | { readonly kind: "work"; readonly objective: NodeObjective }
  | { readonly kind: "control"; readonly purpose: ControlPurpose; readonly title: string };

export type NodeEvent =
  | NodeEventRecord<"node-created", { readonly projectId: ProjectId; readonly objective: NodeObjective; readonly requirement?: NodeRequirement }>
  | NodeEventRecord<"control-created", { readonly projectId: ProjectId; readonly purpose: ControlPurpose; readonly title: string; readonly requirement?: NodeRequirement }>
  | NodeEventRecord<"definition-changed", {
      readonly definition: NodeDefinitionChange;
      readonly requirement: NodeRequirement;
      readonly reason: string;
      readonly reviewedRevision: number;
    }>
  | NodeEventRecord<"session-bound", { readonly sessionId: SessionId }>
  | NodeEventRecord<"node-unlocked" | "node-locked", { readonly reason: string }>
  | NodeEventRecord<"work-started" | "work-ended", Record<string, never>>
  | NodeEventRecord<"completion-confirmed" | "node-skipped", NodeConfirmation>
  | NodeEventRecord<"requirement-changed", { readonly requirement: NodeRequirement; readonly reason: string; readonly reviewedRevision: number }>;

export type NodeEventDraft<T extends NodeEvent = NodeEvent> = T extends NodeEvent
  ? Omit<T, "version" | "id" | "revision" | "timestamp"> : never;

export interface NodeEventRecord<TType extends string, TData> {
  readonly version: 2;
  readonly id: EventId;
  readonly nodeId: NodeId;
  readonly revision: number;
  readonly timestamp: string;
  readonly type: TType;
  readonly data: TData;
}
