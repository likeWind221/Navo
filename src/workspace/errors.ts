export class WorkspaceError extends Error {
  constructor(
    readonly code: WorkspaceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkspaceError";
  }
}

export type WorkspaceErrorCode =
  | "invalid-config"
  | "project-not-found"
  | "workspace-not-found"
  | "workspace-conflict"
  | "invalid-ref"
  | "path-not-allowed"
  | "not-found"
  | "not-a-directory"
  | "permission-denied"
  | "io-failed";
