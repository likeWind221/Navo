import { RpcError } from "../../errors.js";
import type { ResourceViewCopyInputV1, ResourceViewCopyV1 } from "../view.js";
import { exactKeys, requireBoundedString, requireRecord } from "../../validation.js";

const ID_MAX = 128;
const TEXT_MAX = 4_096;

export function parseResourceViewCopyInput(value: unknown): ResourceViewCopyInputV1 {
  const input = shape(value, ["projectId", "resourceId", "expectedRevision"], "resource view copy input");
  return {
    projectId: id(input.projectId, "projectId"),
    resourceId: id(input.resourceId, "resourceId"),
    expectedRevision: positive(input.expectedRevision, "expectedRevision"),
  };
}

export function parseResourceViewCopy(value: unknown): ResourceViewCopyV1 {
  const copy = shape(value, ["projectId", "resourceId", "name", "type", "revision", "assetGeneration", "copyPath"], "resource view copy");
  return {
    projectId: id(copy.projectId, "projectId"),
    resourceId: id(copy.resourceId, "resourceId"),
    name: text(copy.name, "name"),
    type: text(copy.type, "type"),
    revision: positive(copy.revision, "revision"),
    assetGeneration: positive(copy.assetGeneration, "assetGeneration"),
    copyPath: text(copy.copyPath, "copyPath"),
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

function text(value: unknown, label: string): string {
  return requireBoundedString(value, label, TEXT_MAX);
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid(`${label} must be a positive integer`);
  return value as number;
}

function invalid(message: string): never {
  throw new RpcError("invalid-frame", message);
}
