import type { EventId, ProjectId, SessionId } from "../brand/ids.js";

export type ProjectEvent =
  | ProjectEventRecord<"project-created", {
      readonly goal: string;
      readonly mainSessionId: SessionId;
    }>
  | ProjectEventRecord<"project-archived", { readonly reason: string }>
  | ProjectEventRecord<"project-reopened", { readonly reason: string }>;

export interface ProjectEventRecord<TType extends string, TData> {
  readonly version: 1;
  readonly id: EventId;
  readonly projectId: ProjectId;
  readonly revision: number;
  readonly timestamp: string;
  readonly type: TType;
  readonly data: TData;
}
