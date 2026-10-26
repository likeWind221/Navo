import { RpcError } from "./errors.js";
import type { RpcMethod, RpcOutputValidator } from "./protocol.js";
export { resourceViewCopyMethod } from "./resource/view.js";
export type { ResourceViewCopyInputV1, ResourceViewCopyV1 } from "./resource/view.js";
export { resourceContentRetryMethod } from "./resource/content.js";
export { resourceContentCancelMethod } from "./resource/content.js";
export { resourceQueryMethod } from "./resource/query.js";
export { resourceSearchMethod } from "./resource/search.js";
export { resourceGraphStatusMethod } from "./resource/graph.js";
export type { ResourceGraphStatusInputV1, ResourceGraphStatusResultV1, ResourceGraphStatusItemV1 } from "./resource/graph.js";
export type { ResourceSearchInputV1, ResourceSearchResultV1 } from "./resource/search.js";
export type { ResourceQueryInputV1, ResourceQueryResultV1, ResourceQueryItemV1, ResourceIndexStatusV1 } from "./resource/query.js";
export type {
  ResourceContentCancelInputV1,
  ResourceContentCancelResultV1,
  ResourceContentRetryInputV1,
  ResourceContentRetryResultV1,
} from "./resource/content.js";
import type { ProjectResourceAccessV1, ProjectResourceOwnerV1 } from "./project.js";
import {
  parseFolderCreateInput,
  parseFolderDeleteInput,
  parseFolderDeleteResult,
  parseFolderOrganizeInput,
  parseLibraryDirectory,
  parseLibraryInput,
  parseLibraryItem,
  parseLibrarySnapshot,
  parseResourceDeleteInput,
  parseResourceDeleteResult,
  parseResourceReplaceInput,
  parseResourceUpdateInput,
  parseUserImportInput,
  parseUserImportItem,
} from "./resource/validation.js";

export const resourceLibraryBrowseMethod: RpcMethod<ResourceLibraryInputV1, ResourceLibrarySnapshotV1> = method(
  "resource.library.browse.v1", parseLibraryInput, parseLibrarySnapshot,
);

export const resourceLibraryFollowMethod: RpcMethod<ResourceLibraryInputV1, ResourceLibrarySnapshotV1> = Object.freeze({
  name: "resource.library.follow.v1",
  parseInput: parseLibraryInput,
  parseOutput: parseLibrarySnapshot,
  createOutputValidator: (input: ResourceLibraryInputV1) => {
    let received = false;
    return {
      parse(value: unknown) {
        const snapshot = parseLibrarySnapshot(value);
        if (snapshot.projectId !== input.projectId || snapshot.path !== input.path) {
          throw new RpcError("invalid-output", "Resource library follow crossed its requested scope");
        }
        received = true;
        return snapshot;
      },
      end() {
        if (!received) throw new RpcError("invalid-output", "Resource library follow ended before its baseline");
      },
    };
  },
});

export const resourceFolderCreateMethod: RpcMethod<ResourceFolderCreateInputV1, ResourceLibraryDirectoryV1> = method(
  "resource.folder.create.v1", parseFolderCreateInput, parseLibraryDirectory,
);

export const resourceFolderOrganizeMethod: RpcMethod<ResourceFolderOrganizeInputV1, ResourceLibraryDirectoryV1> = method(
  "resource.folder.organize.v1", parseFolderOrganizeInput, parseLibraryDirectory,
);

export const resourceFolderDeleteMethod: RpcMethod<ResourceFolderDeleteInputV1, ResourceFolderDeleteResultV1> = method(
  "resource.folder.delete.v1", parseFolderDeleteInput, parseFolderDeleteResult,
);

export const resourceUpdateMethod: RpcMethod<ResourceUpdateInputV1, ResourceLibraryItemV1> = method(
  "resource.update.v1", parseResourceUpdateInput, parseLibraryItem,
);

export const resourceReplaceMethod: RpcMethod<ResourceReplaceInputV1, ResourceLibraryItemV1> = method(
  "resource.replace.v1", parseResourceReplaceInput, parseLibraryItem,
);

export const resourceDeleteMethod: RpcMethod<ResourceDeleteInputV1, ResourceDeleteResultV1> = method(
  "resource.delete.v1", parseResourceDeleteInput, parseResourceDeleteResult,
);

export const userImportMethod: RpcMethod<UserImportInputV1, UserImportItemV1> = Object.freeze({
  name: "resource.user-import.v1",
  parseInput: parseUserImportInput,
  parseOutput: parseUserImportItem,
});

export type ResourceFailureCode =
  | "invalid-request"
  | "project-unavailable"
  | "resource-unavailable"
  | "folder-unavailable"
  | "path-conflict"
  | "revision-conflict"
  | "operation-conflict"
  | "query-changed"
  | "search-expired"
  | "search-changed"
  | "internal";

export interface ResourceLibraryInputV1 {
  readonly projectId: string;
  readonly path: string | null;
}

export interface ResourceLibrarySnapshotV1 {
  readonly projectId: string;
  readonly path: string | null;
  readonly directories: readonly ResourceLibraryDirectoryV1[];
  readonly resources: readonly ResourceLibraryItemV1[];
}

export interface ResourceLibraryDirectoryV1 {
  readonly path: string;
  readonly explicit: boolean;
}

export interface ResourceLibraryItemV1 {
  readonly resourceId: string;
  readonly owner: ProjectResourceOwnerV1;
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly libraryPath: string;
  readonly access: ProjectResourceAccessV1;
  readonly revision: number;
  readonly assetGeneration: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly content: ResourceContentStatusV1 | null;
}

export interface ResourceContentStatusV1 {
  readonly status: "pending" | "processing" | "ready" | "metadata_only" | "failed";
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  readonly updatedAt: string;
}

export interface ResourceFolderCreateInputV1 {
  readonly projectId: string;
  readonly path: string;
}

export interface ResourceFolderOrganizeInputV1 {
  readonly projectId: string;
  readonly path: string;
  readonly targetPath: string;
}

export interface ResourceFolderDeleteInputV1 {
  readonly projectId: string;
  readonly path: string;
  readonly recursive: boolean;
  readonly operationId: string;
}

export interface ResourceFolderDeleteResultV1 {
  readonly status: "confirmation-required" | "deleted" | "partial" | "cancelled";
  readonly deleted: readonly string[];
  readonly failed: readonly { readonly resourceId: string; readonly code: string }[];
}

export interface ResourceUpdateInputV1 {
  readonly projectId: string;
  readonly resourceId: string;
  readonly expectedRevision: number;
  readonly name?: string;
  readonly folder?: string;
  readonly description?: string;
}

export interface ResourceReplaceInputV1 {
  readonly projectId: string;
  readonly resourceId: string;
  readonly expectedRevision: number;
  readonly operationId: string;
  readonly sourcePath: string;
}

export interface ResourceDeleteInputV1 {
  readonly projectId: string;
  readonly resourceId: string;
  readonly expectedRevision: number;
  readonly operationId: string;
}

export interface ResourceDeleteResultV1 {
  readonly resourceId: string;
  readonly deleted: true;
}

export interface UserImportInputV1 {
  readonly projectId: string;
  readonly requestId: string;
  readonly sources: readonly UserImportSourceV1[];
}

export interface UserImportSourceV1 {
  readonly kind: "file" | "directory";
  readonly path: string;
}

export type UserImportItemV1 =
  | { readonly status: "saved"; readonly name: string; readonly relativePath: string;
      readonly resourceId: string; readonly libraryPath: string;
      readonly contentStatus: "pending" | "processing" | "ready" | "metadata_only" | "failed" | null }
  | { readonly status: "failed"; readonly name: string; readonly relativePath: string;
      readonly code: string; readonly message: string }
  | { readonly status: "cancelled"; readonly name: string; readonly relativePath: string };

function method<TInput, TOutput>(
  name: string,
  parseInput: (value: unknown) => TInput,
  parseOutput: (value: unknown) => TOutput,
): RpcMethod<TInput, TOutput> {
  return Object.freeze({ name, parseInput, parseOutput, createOutputValidator: () => singleOutput(parseOutput) });
}

function singleOutput<T>(parse: (value: unknown) => T): RpcOutputValidator<T> {
  let received = false;
  return {
    parse(value) {
      if (received) throw new RpcError("invalid-output", "Resource method returns exactly one item");
      received = true;
      return parse(value);
    },
    end() {
      if (!received) throw new RpcError("invalid-output", "Resource method ended without a result");
    },
  };
}
