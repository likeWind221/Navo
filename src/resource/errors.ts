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
  | "resource-unavailable"
  | "resource-already-exists"
  | "registry-already-restored"
  | "invalid-resource"
  | "invalid-history"
  | "resource-target-missing";
