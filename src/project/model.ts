import type { ProjectId, SessionId } from "../brand/ids.js";

export interface ProjectSnapshot {
  readonly id: ProjectId;
  readonly name: string;
  readonly goal: string | null;
  readonly mainSessionId: SessionId;
  readonly status: ProjectStatus;
  readonly revision: number;
  readonly createdAt: string;
}

export type ProjectStatus = "active" | "archived";

export const PROJECT_GOAL_MAX_CHARS = 8_000;
