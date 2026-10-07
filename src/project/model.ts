import type { ProjectId, SessionId } from "../brand/ids.js";

export interface ProjectSnapshot {
  readonly id: ProjectId;
  readonly name: string;
  readonly goal: string;
  readonly mainSessionId: SessionId;
  readonly status: ProjectStatus;
  readonly revision: number;
  readonly createdAt: string;
}

export type ProjectStatus = "active" | "archived";
