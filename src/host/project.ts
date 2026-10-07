import type { Context } from "cordis";

import {
  projectCreateMethod,
  projectGetMethod,
  projectListMethod,
  projectMailboxMethod,
  projectResourcesMethod,
} from "../../rpc/project.js";
import type {
  NodeV1,
  ProjectCreateInput,
  ProjectDetailV1,
  ProjectListV1,
  ProjectMailboxInput,
  ProjectMailboxV1,
  ProjectParticipantV1,
  ProjectResourcesV1,
  ProjectSummaryV1,
} from "../../rpc/project.js";
import { RpcError } from "../../rpc/errors.js";
import type { StreamRpcRouter } from "../../rpc/stream/router.js";
import type { RpcStreamHandler } from "../../rpc/stream.js";
import { createProjectId } from "../brand/ids.js";
import type { ProjectId } from "../brand/ids.js";
import type { MailboxParticipant } from "../mailbox/model.js";
import type { NodeSnapshot } from "../node/model.js";
import type { ProjectSnapshot } from "../project/model.js";
import type { ProjectResource } from "../resource/model.js";
import { projectFailure, toProjectFailure } from "./project/failure.js";

export const MAILBOX_PAGE_BODY_BUDGET = 524_288;

export function registerProjectMethods(router: StreamRpcRouter, ctx: Context): () => void {
  const unregister = [
    router.register(projectListMethod, unary(() => listProjects(ctx))),
    router.register(projectCreateMethod, unary(input => createProject(ctx, input))),
    router.register(projectGetMethod, unary(input => getProject(ctx, input.projectId))),
    router.register(projectMailboxMethod, unary(input => readMailbox(ctx, input))),
    router.register(projectResourcesMethod, unary(input => listResources(ctx, input.projectId))),
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

async function getProject(ctx: Context, projectId: string): Promise<ProjectDetailV1> {
  const project = requireProject(ctx, projectId);
  const roadmap = ctx.roadmaps.get(project.id) === undefined ? undefined : ctx.roadmaps.map(project.id);
  return {
    project: await summarize(ctx, project),
    main: { sessionId: project.mainSessionId, turnActive: ctx.projectRuntime.isMainActive(project.id) },
    roadmap: roadmap === undefined ? null : {
      revision: roadmap.roadmapRevision,
      nodes: roadmap.nodes.map(node => describeNode(ctx, project.id, node)),
      edges: roadmap.edges.map(edge => ({ from: edge.from, to: edge.to })),
    },
  };
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

async function summarize(ctx: Context, project: ProjectSnapshot): Promise<ProjectSummaryV1> {
  const workspace = await ctx.projectWorkspaces.get(project.id);
  return {
    projectId: project.id,
    name: project.name,
    goal: project.goal,
    workspaceRoot: workspace?.root ?? null,
    status: project.status,
    revision: project.revision,
    createdAt: project.createdAt,
  };
}

function describeNode(ctx: Context, projectId: ProjectId, snapshot: NodeSnapshot): NodeV1 {
  const { node } = snapshot;
  return {
    nodeId: node.id,
    revision: snapshot.revision,
    kind: node.kind,
    requirement: node.requirement,
    status: snapshot.status,
    title: node.kind === "work" ? node.objective.title : node.title,
    description: node.kind === "work" ? node.objective.description : "",
    acceptanceCriteria: node.kind === "work" ? [...node.objective.acceptanceCriteria] : [],
    controlPurpose: node.kind === "control" ? node.purpose : null,
    hasSession: snapshot.sessionId !== undefined,
    turnActive: ctx.projectRuntime.isNodeActive(node.id),
    actions: { ...ctx.projectRuntime.nodeActions(projectId, node.id) },
    confirmation: snapshot.confirmation === undefined ? null : { ...snapshot.confirmation },
  };
}

function describeResource(resource: ProjectResource): ProjectResourcesV1["resources"][number] {
  return {
    resourceId: resource.id,
    owner: participant(resource.owner),
    name: resource.name,
    description: resource.description,
    type: resource.type,
    entryRef: resource.entryRef,
    access: resource.access.kind === "shared"
      ? { kind: "shared", nodeIds: [...resource.access.nodeIds] }
      : { kind: resource.access.kind },
    revision: resource.revision,
    createdAt: resource.createdAt,
    updatedAt: resource.updatedAt,
  };
}

function participant(value: MailboxParticipant): ProjectParticipantV1 {
  return value.kind === "main" ? { kind: "main" } : { kind: "node", nodeId: value.nodeId };
}

function requireProject(ctx: Context, projectId: string): ProjectSnapshot {
  const project = ctx.projects.get(createProjectId(projectId));
  if (project === undefined) throw projectFailure("project-not-found", "Project was not found.");
  return project;
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
