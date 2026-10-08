import type { EventId, ProjectId, SessionId } from "../brand/ids.js";

declare module "cordis" {
  interface Events {
    "project/changed"(projectId: ProjectId): void;
  }
}

export type ProjectEvent =
  | ProjectEventRecord<"project-created", {
      readonly name: string;
      readonly goal: string | null;
      readonly mainSessionId: SessionId;
    }>
  | ProjectEventRecord<"project-goal-set", { readonly goal: string }>
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
