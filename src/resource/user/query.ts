import type { Context } from "cordis";
import type { ProjectId } from "../../brand/ids.js";
import { ResourceError } from "../errors.js";
import { insideFolder, libraryPathKey, normalizeLibraryPath } from "../library.js";
import type { ProjectResource } from "../model.js";
import type { ResourceContentRecord } from "../../storage/content.js";
import type { CurrentResourceIndexStatus } from "../index.js";

export interface UserResourceQueryInput {
  readonly projectId: ProjectId;
  readonly query?: string;
  readonly folder?: string | null;
  readonly limit?: number;
  readonly offset?: number;
  readonly expectedChangeToken?: string;
}

export interface UserResourceQueryItem {
  readonly resource: ProjectResource;
  readonly content: ResourceContentRecord | undefined;
  readonly index: CurrentResourceIndexStatus;
}

export interface UserResourceQueryResult {
  readonly projectId: ProjectId;
  readonly query: string;
  readonly folder: string | null;
  readonly resources: readonly UserResourceQueryItem[];
  readonly nextOffset: number | null;
  readonly changeToken: string;
}

const DEFAULT_LIMIT = 30;
const TOKEN_VERSION = 1;

export function queryUserResources(
  ctx: Context,
  input: UserResourceQueryInput,
  signal: AbortSignal,
): UserResourceQueryResult {
  signal.throwIfAborted();
  const query = (input.query ?? "").trim().toLowerCase();
  const folder = input.folder === undefined || input.folder === null || input.folder === ""
    ? null : normalizeLibraryPath(input.folder);
  const folderKey = folder === null ? null : libraryPathKey(folder);
  const limit = input.limit ?? DEFAULT_LIMIT;
  const offset = input.offset ?? 0;
  const configurationKey = ctx.resourceIndex.configurationKey();
  const resources = ctx.resources.listByProject(input.projectId)
    .filter(resource => (folder === null || insideFolder(resource.libraryPath, folder))
      && (query === "" || resource.name.toLowerCase().includes(query) || resource.description.toLowerCase().includes(query)))
    .sort(compareResources);
  const currentVersion = ctx.storage.atomic(tx => tx.getCatalogVersion(input.projectId));
  const currentToken = encodeToken(input.projectId, query, folderKey, currentVersion, configurationKey);
  if (input.expectedChangeToken !== undefined && !sameToken(input.expectedChangeToken, currentToken)) {
    throw new ResourceError("query-changed", "The Resource query changed; start a new page from the first result.");
  }
  signal.throwIfAborted();
  const snapshot = ctx.storage.atomic(tx => {
    const page = resources.slice(offset, offset + limit);
    const items = page.map(resource => ({
      resource,
      content: ctx.content.status(input.projectId, resource.id),
      index: ctx.resourceIndex.currentStatus(input.projectId, resource.id),
    }));
    return { items, version: tx.getCatalogVersion(input.projectId) };
  });
  if (snapshot.version !== currentVersion) {
    throw new ResourceError("query-changed", "The Resource query changed; start a new page from the first result.");
  }
  signal.throwIfAborted();
  return {
    projectId: input.projectId,
    query,
    folder,
    resources: snapshot.items,
    nextOffset: offset + snapshot.items.length < resources.length ? offset + snapshot.items.length : null,
    changeToken: currentToken,
  };
}

export function encodeToken(
  projectId: ProjectId,
  query: string,
  folder: string | null,
  version: number,
  configurationKey: string,
): string {
  return JSON.stringify({ v: TOKEN_VERSION, projectId, query, folder, version, configurationKey });
}

function sameToken(value: string, current: string): boolean {
  try {
    const parsed = JSON.parse(value) as unknown;
    return JSON.stringify(parsed) === current;
  } catch {
    return false;
  }
}

function compareResources(left: ProjectResource, right: ProjectResource): number {
  return compareText(left.libraryPath, right.libraryPath) || compareText(left.id, right.id);
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
