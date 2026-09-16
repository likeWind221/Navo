import type { ProjectId, SessionId } from "../brand/ids.js";

export interface ProjectSnapshot {
  readonly id: ProjectId;
  readonly goal: string;
  readonly mainSessionId: SessionId;
  readonly status: ProjectStatus;
  readonly revision: number;
}

export type ProjectStatus = "active" | "archived";
