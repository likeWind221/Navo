export type ResourceIndexErrorCode = "embedding-unconfigured" | "invalid-query" | "index-failed" | "index-stale";

export class ResourceIndexError extends Error {
  constructor(readonly code: ResourceIndexErrorCode, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ResourceIndexError";
  }
}
