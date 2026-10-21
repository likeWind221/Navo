export class ResourceError extends Error {
  constructor(
    readonly code: ResourceErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ResourceError";
  }
}

export type ResourceErrorCode =
  | "project-unavailable"
  | "node-unavailable"
  | "workspace-unavailable"
  | "resource-unavailable"
  | "resource-already-exists"
  | "registry-already-restored"
  | "invalid-resource"
  | "invalid-access"
  | "invalid-history"
  | "stale-revision"
  | "operation-result-stale"
  | "resource-not-owned"
  | "resource-content-unavailable"
  | "folder-unavailable"
  | "folder-conflict";
