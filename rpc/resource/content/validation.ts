import { RpcError } from "../../errors.js";
import type { ResourceContentRetryInputV1, ResourceContentRetryResultV1 } from "../content.js";
import { exactKeys, requireBoundedString, requireRecord } from "../../validation.js";

const ID_MAX = 128;

export function parseContentRetryInput(value: unknown): ResourceContentRetryInputV1 {
  const input = shape(value, ["projectId", "resourceId", "expectedRevision"], "resource content retry input");
  return {
    projectId: id(input.projectId, "projectId"),
    resourceId: id(input.resourceId, "resourceId"),
    expectedRevision: positive(input.expectedRevision, "expectedRevision"),
  };
}

export function parseContentRetryResult(value: unknown): ResourceContentRetryResultV1 {
  const result = shape(value, ["projectId", "resourceId", "revision", "assetGeneration", "status", "contentStatus"], "resource content retry result");
  if (result.status !== "accepted") invalid("Unknown resource content retry status");
  if (result.contentStatus !== "pending") invalid("Resource content retry must return pending content status");
  return {
    projectId: id(result.projectId, "projectId"),
    resourceId: id(result.resourceId, "resourceId"),
    revision: positive(result.revision, "revision"),
    assetGeneration: positive(result.assetGeneration, "assetGeneration"),
    status: "accepted",
    contentStatus: "pending",
  };
}

function shape(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const record = requireRecord(value, label);
  if (!exactKeys(record, keys)) invalid(`Malformed ${label}`);
  return record;
}

function id(value: unknown, label: string): string {
  return requireBoundedString(value, label, ID_MAX);
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid(`${label} must be a positive integer`);
  return value as number;
}

function invalid(message: string): never {
  throw new RpcError("invalid-frame", message);
}
