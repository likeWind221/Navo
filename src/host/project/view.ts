import type { Context } from "cordis";

import type {
  NodeV1,
  ProjectDetailV1,
  ProjectParticipantV1,
  ProjectResourceV1,
  ProjectSummaryV1,
} from "../../../rpc/project.js";
import { createProjectId } from "../../brand/ids.js";
import type { ProjectId } from "../../brand/ids.js";
import type { MailboxParticipant } from "../../mailbox/model.js";
import type { NodeSnapshot } from "../../node/model.js";
import type { ProjectSnapshot } from "../../project/model.js";
import type { ProjectResource } from "../../resource/model.js";
import { projectFailure } from "./failure.js";

export async function getProject(ctx: Context, projectId: string): Promise<ProjectDetailV1> {
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

export async function summarize(ctx: Context, project: ProjectSnapshot): Promise<ProjectSummaryV1> {
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

export function describeNode(ctx: Context, projectId: ProjectId, snapshot: NodeSnapshot): NodeV1 {
  const { node } = snapshot;
  return {
    nodeId: node.id,
    revision: snapshot.revision,
    requirement: node.requirement,
    status: snapshot.status,
    title: node.objective.title,
    description: node.objective.description,
    acceptanceCriteria: [...node.objective.acceptanceCriteria],
    hasSession: snapshot.sessionId !== undefined,
    turnActive: ctx.projectRuntime.isNodeActive(node.id),
    actions: { ...ctx.projectRuntime.nodeActions(projectId, node.id) },
    confirmation: snapshot.confirmation === undefined ? null : { ...snapshot.confirmation },
    submission: snapshot.submission === undefined ? null : {
      ...snapshot.submission,
      resourceIds: [...snapshot.submission.resourceIds],
      criteria: snapshot.submission.criteria.map(check => ({ ...check })),
      remaining: [...snapshot.submission.remaining],
    },
    pendingFeedback: snapshot.pendingFeedback === undefined ? null : { ...snapshot.pendingFeedback },
    review: snapshot.lastReview === undefined ? null : {
      decision: snapshot.lastReview.decision,
      reason: snapshot.lastReview.reason,
      turnId: snapshot.lastReview.turnId === undefined ? null : String(snapshot.lastReview.turnId),
      reviewedRevision: snapshot.lastReview.reviewedRevision,
      reviewedAt: snapshot.lastReview.reviewedAt,
    },
    reworkCount: snapshot.reworkCount ?? 0,
    reviewPending: ctx.reviews.isPending(snapshot),
  };
}

export function describeResource(resource: ProjectResource): ProjectResourceV1 {
  return {
    resourceId: resource.id,
    owner: resource.owner.kind === "user" ? { kind: "user" } : participant(resource.owner),
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

export function participant(value: MailboxParticipant): ProjectParticipantV1 {
  return value.kind === "main" ? { kind: "main" } : { kind: "node", nodeId: value.nodeId };
}

export function requireProject(ctx: Context, projectId: string): ProjectSnapshot {
  const project = ctx.projects.get(createProjectId(projectId));
  if (project === undefined) throw projectFailure("project-not-found", "Project was not found.");
  return project;
}
