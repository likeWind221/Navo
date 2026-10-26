import type { Context } from "cordis";
import { RpcError } from "../../../rpc/errors.js";
import type { ResourceLibraryItemV1, ResourceLibrarySnapshotV1 } from "../../../rpc/resource.js";
import type { ResourceViewCopyInputV1, ResourceViewCopyV1 } from "../../../rpc/resource/view.js";
import type { RpcStreamHandler } from "../../../rpc/stream.js";
import { createProjectId, createResourceId, type ProjectId } from "../../brand/ids.js";
import type { ProjectResource } from "../../resource/model.js";
import { toResourceFailure } from "./failure.js";

export function describeLibrarySnapshot(
  ctx: Context,
  projectId: ProjectId,
  path: string | null,
): ResourceLibrarySnapshotV1 {
  const library = ctx.userResources.browse(projectId, path);
  return {
    projectId,
    path,
    directories: library.directories.map(directory => ({ ...directory })),
    resources: library.resources.map(({ resource }) => describeLibraryItem(ctx, resource)),
  };
}

export function describeLibraryItem(ctx: Context, resource: ProjectResource): ResourceLibraryItemV1 {
  const content = ctx.content.status(resource.projectId, resource.id);
  return {
    resourceId: resource.id,
    owner: resource.owner.kind === "node" ? { kind: "node", nodeId: resource.owner.nodeId } : { kind: resource.owner.kind },
    name: resource.name,
    description: resource.description,
    type: resource.type,
    libraryPath: resource.libraryPath,
    access: resource.access.kind === "shared"
      ? { kind: "shared", nodeIds: [...resource.access.nodeIds] }
      : { kind: resource.access.kind },
    revision: resource.revision,
    assetGeneration: resource.assetGeneration,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
    content: content === undefined ? null : {
      status: content.status,
      errorCode: content.error_code,
      errorMessage: content.error_message,
      updatedAt: content.updated_at,
    },
  };
}

export function createResourceViewCopyHandler(
  ctx: Context,
): RpcStreamHandler<ResourceViewCopyInputV1, ResourceViewCopyV1> {
  return async function* (input, signal) {
    signal.throwIfAborted();
    try {
      yield await ctx.userResources.createViewCopy({
        projectId: createProjectId(input.projectId),
        resourceId: createResourceId(input.resourceId),
        expectedRevision: input.expectedRevision,
      }, signal);
    } catch (error: unknown) {
      if (error instanceof RpcError) throw error;
      throw toResourceFailure(error);
    }
  };
}
