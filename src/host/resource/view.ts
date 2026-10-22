import type { Context } from "cordis";
import type { ResourceLibraryItemV1, ResourceLibrarySnapshotV1 } from "../../../rpc/resource.js";
import type { ProjectId } from "../../brand/ids.js";
import type { ProjectResource } from "../../resource/model.js";

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
