export class ProjectError extends Error {
  constructor(readonly code: ProjectErrorCode, message: string) {
    super(message);
    this.name = "ProjectError";
  }
}

export type ProjectErrorCode =
  | "turn-active"
  | "runtime-unavailable"
  | "project-not-found"
  | "project-already-exists"
  | "project-unavailable"
  | "session-already-owned"
  | "invalid-message"
  | "invalid-event-stream";
