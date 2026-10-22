import { RpcError } from "../errors.js";
import type {
  ResourceDeleteInputV1,
  ResourceDeleteResultV1,
  ResourceFolderCreateInputV1,
  ResourceFolderDeleteInputV1,
  ResourceFolderDeleteResultV1,
  ResourceFolderOrganizeInputV1,
  ResourceLibraryDirectoryV1,
  ResourceLibraryInputV1,
  ResourceLibraryItemV1,
  ResourceLibrarySnapshotV1,
  ResourceReplaceInputV1,
  ResourceUpdateInputV1,
  UserImportInputV1,
  UserImportItemV1,
} from "../resource.js";
import { exactKeys, requireBoundedString, requireRecord } from "../validation.js";

const ID_MAX = 128;
const PATH_MAX = 4_096;
const TEXT_MAX = 8_000;
const ITEM_MAX = 4_096;

export function parseLibraryInput(value: unknown): ResourceLibraryInputV1 {
  const input = shape(value, ["projectId", "path"], "resource library input");
  return { projectId: id(input.projectId, "projectId"), path: nullablePath(input.path) };
}

export function parseLibrarySnapshot(value: unknown): ResourceLibrarySnapshotV1 {
  const snapshot = shape(value, ["projectId", "path", "directories", "resources"], "resource library snapshot");
  return {
    projectId: id(snapshot.projectId, "projectId"),
    path: nullablePath(snapshot.path),
    directories: array(snapshot.directories, "directories", 10_000).map(parseLibraryDirectory),
    resources: array(snapshot.resources, "resources", 10_000).map(parseLibraryItem),
  };
}

export function parseLibraryDirectory(value: unknown): ResourceLibraryDirectoryV1 {
  const directory = shape(value, ["path", "explicit"], "resource library directory");
  if (typeof directory.explicit !== "boolean") invalid("Directory explicit flag must be boolean");
  return { path: path(directory.path, "directory path"), explicit: directory.explicit };
}

export function parseLibraryItem(value: unknown): ResourceLibraryItemV1 {
  const item = shape(value, ["resourceId", "owner", "name", "description", "type", "libraryPath", "access",
    "revision", "assetGeneration", "createdAt", "updatedAt", "content"], "resource library item");
  return {
    resourceId: id(item.resourceId, "resourceId"),
    owner: owner(item.owner),
    name: text(item.name, "resource name", ITEM_MAX, false),
    description: text(item.description, "resource description", TEXT_MAX, true),
    type: text(item.type, "resource type", ITEM_MAX, false),
    libraryPath: path(item.libraryPath, "libraryPath"),
    access: access(item.access),
    revision: positive(item.revision, "resource revision"),
    assetGeneration: positive(item.assetGeneration, "asset generation"),
    createdAt: timestamp(item.createdAt, "createdAt"),
    updatedAt: timestamp(item.updatedAt, "updatedAt"),
    content: item.content === null ? null : content(item.content),
  };
}

export function parseFolderCreateInput(value: unknown): ResourceFolderCreateInputV1 {
  const input = shape(value, ["projectId", "path"], "folder create input");
  return { projectId: id(input.projectId, "projectId"), path: path(input.path, "folder path") };
}

export function parseFolderOrganizeInput(value: unknown): ResourceFolderOrganizeInputV1 {
  const input = shape(value, ["projectId", "path", "targetPath"], "folder organize input");
  return { projectId: id(input.projectId, "projectId"), path: path(input.path, "folder path"),
    targetPath: path(input.targetPath, "target folder path") };
}

export function parseFolderDeleteInput(value: unknown): ResourceFolderDeleteInputV1 {
  const input = shape(value, ["projectId", "path", "recursive", "operationId"], "folder delete input");
  if (typeof input.recursive !== "boolean") invalid("Folder recursive flag must be boolean");
  return { projectId: id(input.projectId, "projectId"), path: path(input.path, "folder path"),
    recursive: input.recursive, operationId: operationId(input.operationId) };
}

export function parseFolderDeleteResult(value: unknown): ResourceFolderDeleteResultV1 {
  const result = shape(value, ["status", "deleted", "failed"], "folder delete result");
  if (result.status !== "confirmation-required" && result.status !== "deleted"
    && result.status !== "partial" && result.status !== "cancelled") invalid("Unknown folder deletion status");
  return {
    status: result.status,
    deleted: array(result.deleted, "deleted resources", 10_000).map(value => id(value, "resourceId")),
    failed: array(result.failed, "failed resources", 10_000).map(value => {
      const failure = shape(value, ["resourceId", "code"], "folder delete failure");
      return { resourceId: id(failure.resourceId, "resourceId"), code: id(failure.code, "failure code") };
    }),
  };
}

export function parseResourceUpdateInput(value: unknown): ResourceUpdateInputV1 {
  const input = optionalShape(value, ["projectId", "resourceId", "expectedRevision"],
    ["name", "folder", "description"], "resource update input");
  if (input.name === undefined && input.folder === undefined && input.description === undefined) {
    invalid("Resource update must change at least one field");
  }
  return {
    projectId: id(input.projectId, "projectId"),
    resourceId: id(input.resourceId, "resourceId"),
    expectedRevision: positive(input.expectedRevision, "expectedRevision"),
    ...(input.name === undefined ? {} : { name: text(input.name, "resource name", ITEM_MAX, false) }),
    ...(input.folder === undefined ? {} : { folder: emptyPath(input.folder, "resource folder") }),
    ...(input.description === undefined ? {} : { description: text(input.description, "description", TEXT_MAX, true) }),
  };
}

export function parseResourceReplaceInput(value: unknown): ResourceReplaceInputV1 {
  const input = shape(value, ["projectId", "resourceId", "expectedRevision", "operationId", "sourcePath"],
    "resource replace input");
  return { projectId: id(input.projectId, "projectId"), resourceId: id(input.resourceId, "resourceId"),
    expectedRevision: positive(input.expectedRevision, "expectedRevision"), operationId: operationId(input.operationId),
    sourcePath: path(input.sourcePath, "replacement source path") };
}

export function parseResourceDeleteInput(value: unknown): ResourceDeleteInputV1 {
  const input = shape(value, ["projectId", "resourceId", "expectedRevision", "operationId"], "resource delete input");
  return { projectId: id(input.projectId, "projectId"), resourceId: id(input.resourceId, "resourceId"),
    expectedRevision: positive(input.expectedRevision, "expectedRevision"), operationId: operationId(input.operationId) };
}

export function parseResourceDeleteResult(value: unknown): ResourceDeleteResultV1 {
  const result = shape(value, ["resourceId", "deleted"], "resource delete result");
  if (result.deleted !== true) invalid("Resource deletion result must be true");
  return { resourceId: id(result.resourceId, "resourceId"), deleted: true };
}

export function parseUserImportInput(value: unknown): UserImportInputV1 {
  const input = shape(value, ["projectId", "requestId", "sources"], "user import input");
  const requestId = operationId(input.requestId);
  return {
    projectId: id(input.projectId, "projectId"),
    requestId,
    sources: array(input.sources, "import sources", 32, 1).map(value => {
      const source = shape(value, ["kind", "path"], "import source");
      if (source.kind !== "file" && source.kind !== "directory") invalid("Unknown import source kind");
      return { kind: source.kind, path: path(source.path, "source path") };
    }),
  };
}

export function parseUserImportItem(value: unknown): UserImportItemV1 {
  const item = requireRecord(value, "import item");
  if (item.status === "saved" && exactKeys(item,
    ["status", "name", "relativePath", "resourceId", "libraryPath", "contentStatus"])) {
    const status = item.contentStatus;
    if (status !== null && status !== "pending" && status !== "processing" && status !== "ready"
      && status !== "metadata_only" && status !== "failed") invalid("Unknown import content status");
    return { status: "saved", name: text(item.name, "name", ITEM_MAX, false),
      relativePath: path(item.relativePath, "relativePath"), resourceId: id(item.resourceId, "resourceId"),
      libraryPath: path(item.libraryPath, "libraryPath"), contentStatus: status };
  }
  if (item.status === "failed" && exactKeys(item, ["status", "name", "relativePath", "code", "message"])) {
    return { status: "failed", name: text(item.name, "name", ITEM_MAX, false),
      relativePath: path(item.relativePath, "relativePath"), code: id(item.code, "failure code"),
      message: text(item.message, "failure message", ITEM_MAX, false) };
  }
  if (item.status === "cancelled" && exactKeys(item, ["status", "name", "relativePath"])) {
    return { status: "cancelled", name: text(item.name, "name", ITEM_MAX, false),
      relativePath: path(item.relativePath, "relativePath") };
  }
  return invalid("Malformed import item");
}

function content(value: unknown): NonNullable<ResourceLibraryItemV1["content"]> {
  const record = shape(value, ["status", "errorCode", "errorMessage", "updatedAt"], "resource content status");
  if (record.status !== "pending" && record.status !== "processing" && record.status !== "ready"
    && record.status !== "metadata_only" && record.status !== "failed") invalid("Unknown resource content status");
  return { status: record.status, errorCode: nullableText(record.errorCode, "content error code", ID_MAX),
    errorMessage: nullableText(record.errorMessage, "content error message", 1_000),
    updatedAt: timestamp(record.updatedAt, "content updatedAt") };
}

function owner(value: unknown): ResourceLibraryItemV1["owner"] {
  const record = requireRecord(value, "resource owner");
  if ((record.kind === "user" || record.kind === "main") && exactKeys(record, ["kind"])) return { kind: record.kind };
  if (record.kind === "node" && exactKeys(record, ["kind", "nodeId"])) {
    return { kind: "node", nodeId: id(record.nodeId, "nodeId") };
  }
  return invalid("Malformed resource owner");
}

function access(value: unknown): ResourceLibraryItemV1["access"] {
  const record = requireRecord(value, "resource access");
  if ((record.kind === "private" || record.kind === "public") && exactKeys(record, ["kind"])) return { kind: record.kind };
  if (record.kind === "shared" && exactKeys(record, ["kind", "nodeIds"])) {
    return { kind: "shared", nodeIds: array(record.nodeIds, "nodeIds", 10_000).map(value => id(value, "nodeId")) };
  }
  return invalid("Malformed resource access");
}

function shape(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const record = requireRecord(value, label);
  if (!exactKeys(record, keys)) invalid(`Malformed ${label}`);
  return record;
}

function optionalShape(value: unknown, required: readonly string[], optional: readonly string[], label: string): Record<string, unknown> {
  const record = requireRecord(value, label);
  const keys = Reflect.ownKeys(record);
  if (!required.every(key => Object.hasOwn(record, key))
    || keys.some(key => typeof key !== "string" || (!required.includes(key) && !optional.includes(key)))) {
    invalid(`Malformed ${label}`);
  }
  return record;
}

function array(value: unknown, label: string, maximum: number, minimum = 0): readonly unknown[] {
  if (!Array.isArray(value) || value.length < minimum || value.length > maximum) invalid(`Malformed ${label}`);
  return value;
}

function id(value: unknown, label: string): string {
  return requireBoundedString(value, label, ID_MAX);
}

function operationId(value: unknown): string {
  const result = id(value, "operationId");
  if (!/^[a-zA-Z0-9_-]+$/.test(result)) invalid("Operation identity is malformed");
  return result;
}

function path(value: unknown, label: string): string {
  return text(value, label, PATH_MAX, false);
}

function emptyPath(value: unknown, label: string): string {
  return text(value, label, PATH_MAX, true);
}

function nullablePath(value: unknown): string | null {
  return value === null ? null : path(value, "library path");
}

function text(value: unknown, label: string, maximum: number, empty: boolean): string {
  if (typeof value !== "string" || value.length > maximum || (!empty && value.length === 0) || value.includes("\0")) {
    invalid(`${label} is malformed`);
  }
  return value;
}

function nullableText(value: unknown, label: string, maximum: number): string | null {
  return value === null ? null : text(value, label, maximum, false);
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid(`${label} must be a positive integer`);
  return value as number;
}

function timestamp(value: unknown, label: string): string {
  const result = requireBoundedString(value, label, 64);
  if (!Number.isFinite(Date.parse(result))) invalid(`${label} must be a timestamp`);
  return result;
}

function invalid(message: string): never {
  throw new RpcError("invalid-frame", message);
}
