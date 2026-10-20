import type { FileOperation } from "../storage/operations.js";
import type { ResourceEvent } from "./events.js";

export type CommittedEvent = Extract<ResourceEvent, { type: "resource-created" | "resource-replaced" | "resource-deleted" }>;

export function operationEvent(events: readonly ResourceEvent[], operationId: string): CommittedEvent | undefined {
  return events.find((event): event is CommittedEvent =>
    "operationId" in event.data && event.data.operationId === operationId);
}

export function agreesWithOperation(event: CommittedEvent, operation: FileOperation): boolean {
  const expected = operation.operation_kind === "create" ? "resource-created"
    : operation.operation_kind === "replace" ? "resource-replaced" : "resource-deleted";
  if (event.type !== expected || event.resourceId !== operation.resource_id
    || event.baseRevision !== operation.base_revision || event.revision !== operation.base_revision + 1) return false;
  return event.type === "resource-deleted"
    || (event.data.assetGeneration === operation.target_generation
      && operation.target_relpath === `assets/${event.resourceId}/${event.data.entryRef}`);
}
