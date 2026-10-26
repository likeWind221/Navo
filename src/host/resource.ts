import type { Context } from "cordis";
import {
  resourceDeleteMethod,
  resourceFolderCreateMethod,
  resourceFolderDeleteMethod,
  resourceFolderOrganizeMethod,
  resourceLibraryBrowseMethod,
  resourceLibraryFollowMethod,
  resourceReplaceMethod,
  resourceUpdateMethod,
  userImportMethod,
} from "../../rpc/resource.js";
import { resourceQueryMethod } from "../../rpc/resource/query.js";
import { resourceSearchMethod } from "../../rpc/resource/search.js";
import { resourceContentCancelMethod, resourceContentRetryMethod } from "../../rpc/resource/content.js";
import { resourceGraphStatusMethod } from "../../rpc/resource/graph.js";
import { resourceViewCopyMethod } from "../../rpc/resource/view.js";
import type { StreamRpcRouter } from "../../rpc/stream/router.js";
import type { RpcStreamHandler } from "../../rpc/stream.js";
import { createProjectId, createResourceId } from "../brand/ids.js";
import { createResourceFollowHandler } from "./resource/follow.js";
import { createResourceContentCancelHandler, createResourceContentRetryHandler } from "./resource/content.js";
import { toResourceFailure } from "./resource/failure.js";
import { createResourceViewCopyHandler, describeLibraryItem, describeLibrarySnapshot } from "./resource/view.js";
import { createResourceQueryHandler } from "./resource/query.js";
import { createResourceSearchHandler } from "./resource/search.js";
import { createResourceGraphStatusHandler } from "./resource/graph.js";

export function registerResourceMethods(router: StreamRpcRouter, ctx: Context): () => void {
  const unregister = [
    router.register(userImportMethod, importResources(ctx)),
    router.register(resourceLibraryBrowseMethod, unary(input => describeLibrarySnapshot(ctx,
      createProjectId(input.projectId), input.path))),
    router.register(resourceLibraryFollowMethod, createResourceFollowHandler(ctx)),
    router.register(resourceContentRetryMethod, createResourceContentRetryHandler(ctx)),
    router.register(resourceContentCancelMethod, createResourceContentCancelHandler(ctx)),
    router.register(resourceViewCopyMethod, createResourceViewCopyHandler(ctx)),
    router.register(resourceQueryMethod, createResourceQueryHandler(ctx)),
    router.register(resourceSearchMethod, createResourceSearchHandler(ctx)),
    router.register(resourceGraphStatusMethod, createResourceGraphStatusHandler(ctx)),
    router.register(resourceFolderCreateMethod, unary(input => ctx.userResources.createFolder(
      createProjectId(input.projectId), input.path))),
    router.register(resourceFolderOrganizeMethod, unary(input => ctx.userResources.organizeFolder(
      createProjectId(input.projectId), input.path, input.targetPath))),
    router.register(resourceFolderDeleteMethod, unary((input, signal) => ctx.userResources.deleteFolder({
      ...input, projectId: createProjectId(input.projectId), signal,
    }))),
    router.register(resourceUpdateMethod, unary(input => describeLibraryItem(ctx, ctx.userResources.organizeResource({
      ...input, projectId: createProjectId(input.projectId), resourceId: createResourceId(input.resourceId),
    })))),
    router.register(resourceReplaceMethod, unary(async (input, signal) => describeLibraryItem(ctx,
      await ctx.userResources.replace({ projectId: createProjectId(input.projectId),
        resourceId: createResourceId(input.resourceId), expectedRevision: input.expectedRevision,
        operationId: input.operationId }, input.sourcePath, signal)))),
    router.register(resourceDeleteMethod, unary(async input => {
      await ctx.userResources.delete({ projectId: createProjectId(input.projectId),
        resourceId: createResourceId(input.resourceId), expectedRevision: input.expectedRevision,
        operationId: input.operationId });
      return { resourceId: input.resourceId, deleted: true as const };
    })),
  ];
  return () => { for (const dispose of unregister) dispose(); };
}

function importResources(ctx: Context): RpcStreamHandler<
  import("../../rpc/resource.js").UserImportInputV1,
  import("../../rpc/resource.js").UserImportItemV1
> {
  return async function* (input, signal) {
    try {
      yield* ctx.userResources.import({ ...input, projectId: createProjectId(input.projectId) }, signal);
    } catch (error) {
      throw toResourceFailure(error);
    }
  };
}

function unary<TInput, TOutput>(
  action: (input: TInput, signal: AbortSignal) => TOutput | Promise<TOutput>,
): RpcStreamHandler<TInput, TOutput> {
  return async function* (input, signal) {
    try {
      signal.throwIfAborted();
      yield await action(input, signal);
    } catch (error) {
      throw toResourceFailure(error);
    }
  };
}
