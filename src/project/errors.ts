export class ProjectError extends Error {
  constructor(readonly code: ProjectErrorCode, message: string) {
    super(message);
    this.name = "ProjectError";
  }
}

export type ProjectErrorCode =
  | "auto-run-active"
  | "auto-run-not-found"
  | "auto-run-not-paused"
  | "auto-run-unavailable"
  | "turn-active"
  | "runtime-unavailable"
  | "project-not-found"
  | "project-already-exists"
  | "project-unavailable"
  | "invalid-goal"
  | "session-already-owned"
  | "invalid-message"
  | "invalid-event-stream";
