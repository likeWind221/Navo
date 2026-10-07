import type { Context } from "cordis";

import {
  projectCreateMethod,
  projectFollowMethod,
  projectGetMethod,
  projectListMethod,
  projectMailboxMethod,
  projectNodeReviewMethod,
  projectResourcesMethod,
  projectTurnMethod,
} from "../../rpc/project.js";
import type {
  NodeReviewInput,
  NodeV1,
  ProjectCreateInput,
  ProjectListV1,
  ProjectMailboxInput,
  ProjectMailboxV1,
  ProjectResourcesV1,
  ProjectSummaryV1,
} from "../../rpc/project.js";
import { RpcError } from "../../rpc/errors.js";
import type { StreamRpcRouter } from "../../rpc/stream/router.js";
import type { RpcStreamHandler } from "../../rpc/stream.js";
import { createNodeId, createProjectId } from "../brand/ids.js";
import { toProjectFailure } from "./project/failure.js";
import { createProjectFollowHandler } from "./project/follow.js";
import { createProjectTurnHandler } from "./project/turn.js";
import {
  describeNode,
  describeResource,
  getProject,
  participant,
  requireProject,
  summarize,
} from "./project/view.js";

export const MAILBOX_PAGE_BODY_BUDGET = 524_288;

export function registerProjectMethods(router: StreamRpcRouter, ctx: Context): () => void {
  const unregister = [
    router.register(projectListMethod, unary(() => listProjects(ctx))),
    router.register(projectCreateMethod, unary(input => createProject(ctx, input))),
    router.register(projectGetMethod, unary(input => getProject(ctx, input.projectId))),
    router.register(projectMailboxMethod, unary(input => readMailbox(ctx, input))),
    router.register(projectResourcesMethod, unary(input => listResources(ctx, input.projectId))),
    router.register(projectTurnMethod, createProjectTurnHandler(ctx)),
    router.register(projectNodeReviewMethod, unary(input => reviewNode(ctx, input))),
    router.register(projectFollowMethod, createProjectFollowHandler(ctx)),
  ];
  return () => { for (const dispose of unregister) dispose(); };
}

async function listProjects(ctx: Context): Promise<ProjectListV1> {
  const projects = [...ctx.projects.list()].reverse()
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  return { projects: await Promise.all(projects.map(project => summarize(ctx, project))) };
}

async function createProject(ctx: Context, input: ProjectCreateInput): Promise<ProjectSummaryV1> {
  const project = ctx.projects.create({ name: input.name, goal: input.goal });
  try {
    await ctx.projectWorkspaces.create(project.id, input.workspaceRoot);
  } catch (error: unknown) {
    ctx.projects.discard(project.id);
    throw error;
  }
  return summarize(ctx, project);
}

function readMailbox(ctx: Context, input: ProjectMailboxInput): ProjectMailboxV1 {
  const project = requireProject(ctx, input.projectId);
  const after = input.afterSequence ?? 0;
  const pending = ctx.mailbox.getHistory(project.id).filter(message => message.sequence > after);
  const page = [];
  let budget = MAILBOX_PAGE_BODY_BUDGET;
  for (const message of pending) {
    if (page.length === input.limit || (page.length > 0 && message.body.length > budget)) break;
    budget -= message.body.length;
    page.push({
      messageId: message.id,
      sequence: message.sequence,
      timestamp: message.timestamp,
      sender: participant(message.sender),
      recipient: participant(message.recipient),
      body: message.body,
    });
  }
  return {
    messages: page,
    nextSequence: page.length < pending.length ? page.at(-1)!.sequence : null,
  };
}

function listResources(ctx: Context, projectId: string): ProjectResourcesV1 {
  const project = requireProject(ctx, projectId);
  return { resources: ctx.resources.listByProject(project.id).map(describeResource) };
}

function reviewNode(ctx: Context, input: NodeReviewInput): NodeV1 {
  const projectId = createProjectId(input.projectId);
  const nodeId = createNodeId(input.nodeId);
  const confirmation = { confirmedBy: "human", reason: input.reason, reviewedRevision: input.reviewedRevision };
  const node = input.action === "complete"
    ? ctx.projectRuntime.confirmCompletion(projectId, nodeId, confirmation)
    : ctx.projectRuntime.skipNode(projectId, nodeId, confirmation);
  return describeNode(ctx, projectId, node);
}

function unary<TInput, TOutput>(
  run: (input: TInput) => TOutput | Promise<TOutput>,
): RpcStreamHandler<TInput, TOutput> {
  return async function* project(input) {
    let output: TOutput;
    try {
      output = await run(input);
    } catch (error: unknown) {
      throw error instanceof RpcError ? error : toProjectFailure(error);
    }
    yield output;
  };
}
