export class StorageError extends Error {
  constructor(
    readonly code: StorageErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "StorageError";
  }
}

export type StorageErrorCode =
  | "storage-unavailable"
  | "schema-unsupported"
  | "invalid-record"
  | "write-failed"
  | "sequence-conflict";
