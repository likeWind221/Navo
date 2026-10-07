import { RpcError } from "../errors.js";
import { AGENT_TEXT_MAX_CHARS } from "../agent.js";
import type {
  NodeReviewInput,
  NodeV1,
  ProjectCreateInput,
  ProjectDetailV1,
  ProjectListInput,
  ProjectListV1,
  ProjectMailboxInput,
  ProjectMailboxV1,
  ProjectMessageV1,
  ProjectParticipantV1,
  ProjectRefInput,
  ProjectResourceAccessV1,
  ProjectResourceV1,
  ProjectResourcesV1,
  ProjectSummaryV1,
  ProjectTurnInput,
  RoadmapV1,
} from "../project.js";
import {
  PROJECT_GOAL_MAX_CHARS,
  PROJECT_MAILBOX_PAGE_MAX,
  PROJECT_NAME_MAX_CHARS,
  PROJECT_REVIEW_REASON_MAX_CHARS,
  PROJECT_WORKSPACE_ROOT_MAX_CHARS,
} from "../project.js";
import { exactKeys, requireBoundedString, requireRecord } from "../validation.js";

const ID_MAX = 128;
const TEXT_MAX = 262_144;
const TIMESTAMP_MAX = 64;

export function parseEmptyInput(value: unknown): ProjectListInput {
  shape(value, [], "project list input");
  return {};
}

export function parseProjectCreateInput(value: unknown): ProjectCreateInput {
  const input = shape(value, ["name", "goal", "workspaceRoot"], "project create input");
  return {
    name: visibleText(input.name, "name", PROJECT_NAME_MAX_CHARS),
    goal: visibleText(input.goal, "goal", PROJECT_GOAL_MAX_CHARS),
    workspaceRoot: visibleText(input.workspaceRoot, "workspaceRoot", PROJECT_WORKSPACE_ROOT_MAX_CHARS),
  };
}

export function parseProjectRefInput(value: unknown): ProjectRefInput {
  const input = shape(value, ["projectId"], "project reference input");
  return { projectId: id(input.projectId, "projectId") };
}

export function parseProjectMailboxInput(value: unknown): ProjectMailboxInput {
  const input = shape(value, ["projectId", "afterSequence", "limit"], "project mailbox input");
  if (!Number.isSafeInteger(input.limit) || (input.limit as number) < 1
    || (input.limit as number) > PROJECT_MAILBOX_PAGE_MAX) {
    invalid("Mailbox limit is out of range");
  }
  return {
    projectId: id(input.projectId, "projectId"),
    afterSequence: input.afterSequence === null ? null : count(input.afterSequence, "afterSequence"),
    limit: input.limit as number,
  };
}

export function parseProjectTurnInput(value: unknown): ProjectTurnInput {
  const input = shape(value, ["projectId", "requestId", "text", "target"], "project turn input");
  const target = requireRecord(input.target, "turn target");
  return {
    projectId: id(input.projectId, "projectId"),
    requestId: id(input.requestId, "requestId"),
    text: visibleText(input.text, "turn text", AGENT_TEXT_MAX_CHARS),
    target: target.kind === "main" && exactKeys(target, ["kind"]) ? { kind: "main" }
      : target.kind === "node" && exactKeys(target, ["kind", "nodeId"])
        ? { kind: "node", nodeId: id(target.nodeId, "target nodeId") }
        : invalid("Malformed turn target"),
  };
}

export function parseNodeReviewInput(value: unknown): NodeReviewInput {
  const input = shape(value, ["projectId", "nodeId", "action", "reason", "reviewedRevision"], "node review input");
  return {
    projectId: id(input.projectId, "projectId"),
    nodeId: id(input.nodeId, "nodeId"),
    action: oneOf(input.action, ["complete", "skip"] as const, "review action"),
    reason: visibleText(input.reason, "review reason", PROJECT_REVIEW_REASON_MAX_CHARS),
    reviewedRevision: positive(input.reviewedRevision, "reviewedRevision"),
  };
}

export function parseProjectList(value: unknown): ProjectListV1 {
  const list = shape(value, ["projects"], "project list");
  return { projects: array(list.projects, "projects").map(parseProjectSummary) };
}

export function parseProjectSummary(value: unknown): ProjectSummaryV1 {
  const project = shape(value,
    ["projectId", "name", "goal", "workspaceRoot", "status", "revision", "createdAt"], "project summary");
  return {
    projectId: id(project.projectId, "projectId"),
    name: visibleText(project.name, "name", PROJECT_NAME_MAX_CHARS),
    goal: visibleText(project.goal, "goal", PROJECT_GOAL_MAX_CHARS),
    workspaceRoot: project.workspaceRoot === null ? null
      : visibleText(project.workspaceRoot, "workspaceRoot", PROJECT_WORKSPACE_ROOT_MAX_CHARS),
    status: oneOf(project.status, ["active", "archived"] as const, "project status"),
    revision: positive(project.revision, "revision"),
    createdAt: timestamp(project.createdAt, "createdAt"),
  };
}

export function parseProjectDetail(value: unknown): ProjectDetailV1 {
  const detail = shape(value, ["project", "main", "roadmap"], "project detail");
  const main = shape(detail.main, ["sessionId", "turnActive"], "project main");
  return {
    project: parseProjectSummary(detail.project),
    main: { sessionId: id(main.sessionId, "sessionId"), turnActive: flag(main.turnActive, "turnActive") },
    roadmap: detail.roadmap === null ? null : parseRoadmap(detail.roadmap),
  };
}

function parseRoadmap(value: unknown): RoadmapV1 {
  const roadmap = shape(value, ["revision", "nodes", "edges"], "roadmap");
  return {
    revision: positive(roadmap.revision, "roadmap revision"),
    nodes: array(roadmap.nodes, "nodes").map(parseNode),
    edges: array(roadmap.edges, "edges").map((candidate) => {
      const edge = shape(candidate, ["from", "to"], "roadmap edge");
      return { from: id(edge.from, "edge from"), to: id(edge.to, "edge to") };
    }),
  };
}

export function parseNode(value: unknown): NodeV1 {
  const node = shape(value, ["nodeId", "revision", "kind", "requirement", "status", "title", "description",
    "acceptanceCriteria", "controlPurpose", "hasSession", "turnActive", "actions", "confirmation"], "node");
  const kind = oneOf(node.kind, ["work", "control"] as const, "node kind");
  const controlPurpose = node.controlPurpose === null ? null
    : oneOf(node.controlPurpose, ["start", "end", "checkpoint"] as const, "control purpose");
  if ((kind === "control") !== (controlPurpose !== null)) invalid("Control purpose must match node kind");
  const actions = shape(node.actions, ["run", "complete", "skip"], "node actions");
  return {
    nodeId: id(node.nodeId, "nodeId"),
    revision: positive(node.revision, "node revision"),
    kind,
    requirement: oneOf(node.requirement, ["required", "optional"] as const, "node requirement"),
    status: oneOf(node.status, ["locked", "idle", "working", "completing", "skipped"] as const, "node status"),
    title: visibleText(node.title, "node title", TEXT_MAX),
    description: text(node.description, "node description"),
    acceptanceCriteria: array(node.acceptanceCriteria, "acceptanceCriteria")
      .map(entry => visibleText(entry, "acceptance criterion", TEXT_MAX)),
    controlPurpose,
    hasSession: flag(node.hasSession, "hasSession"),
    turnActive: flag(node.turnActive, "turnActive"),
    actions: {
      run: flag(actions.run, "run action"),
      complete: flag(actions.complete, "complete action"),
      skip: flag(actions.skip, "skip action"),
    },
    confirmation: node.confirmation === null ? null : parseConfirmation(node.confirmation),
  };
}

function parseConfirmation(value: unknown): NodeV1["confirmation"] {
  const confirmation = shape(value, ["confirmedBy", "reason", "reviewedRevision"], "node confirmation");
  return {
    confirmedBy: visibleText(confirmation.confirmedBy, "confirmedBy", ID_MAX),
    reason: visibleText(confirmation.reason, "confirmation reason", TEXT_MAX),
    reviewedRevision: positive(confirmation.reviewedRevision, "reviewedRevision"),
  };
}

export function parseProjectMailbox(value: unknown): ProjectMailboxV1 {
  const mailbox = shape(value, ["messages", "nextSequence"], "project mailbox");
  return {
    messages: array(mailbox.messages, "messages").map(parseMessage),
    nextSequence: mailbox.nextSequence === null ? null : count(mailbox.nextSequence, "nextSequence"),
  };
}

function parseMessage(value: unknown): ProjectMessageV1 {
  const message = shape(value,
    ["messageId", "sequence", "timestamp", "sender", "recipient", "body"], "project message");
  return {
    messageId: id(message.messageId, "messageId"),
    sequence: positive(message.sequence, "sequence"),
    timestamp: timestamp(message.timestamp, "timestamp"),
    sender: parseParticipant(message.sender),
    recipient: parseParticipant(message.recipient),
    body: visibleText(message.body, "message body", TEXT_MAX),
  };
}

function parseParticipant(value: unknown): ProjectParticipantV1 {
  const participant = requireRecord(value, "participant");
  if (participant.kind === "main" && exactKeys(participant, ["kind"])) return { kind: "main" };
  if (participant.kind === "node" && exactKeys(participant, ["kind", "nodeId"])) {
    return { kind: "node", nodeId: id(participant.nodeId, "participant nodeId") };
  }
  return invalid("Malformed participant");
}

export function parseProjectResources(value: unknown): ProjectResourcesV1 {
  const resources = shape(value, ["resources"], "project resources");
  return { resources: array(resources.resources, "resources").map(parseResource) };
}

function parseResource(value: unknown): ProjectResourceV1 {
  const resource = shape(value, ["resourceId", "owner", "name", "description", "type", "entryRef",
    "access", "revision", "createdAt", "updatedAt"], "project resource");
  return {
    resourceId: id(resource.resourceId, "resourceId"),
    owner: parseParticipant(resource.owner),
    name: visibleText(resource.name, "resource name", TEXT_MAX),
    description: text(resource.description, "resource description"),
    type: visibleText(resource.type, "resource type", TEXT_MAX),
    entryRef: visibleText(resource.entryRef, "entryRef", PROJECT_WORKSPACE_ROOT_MAX_CHARS),
    access: parseAccess(resource.access),
    revision: positive(resource.revision, "resource revision"),
    createdAt: timestamp(resource.createdAt, "createdAt"),
    updatedAt: timestamp(resource.updatedAt, "updatedAt"),
  };
}

function parseAccess(value: unknown): ProjectResourceAccessV1 {
  const access = requireRecord(value, "resource access");
  if ((access.kind === "private" || access.kind === "public") && exactKeys(access, ["kind"])) {
    return { kind: access.kind };
  }
  if (access.kind === "shared" && exactKeys(access, ["kind", "nodeIds"])) {
    return { kind: "shared", nodeIds: array(access.nodeIds, "nodeIds").map(entry => id(entry, "nodeId")) };
  }
  return invalid("Malformed resource access");
}

function shape(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const record = requireRecord(value, label);
  if (!exactKeys(record, keys)) invalid(`Malformed ${label}`);
  return record;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  return value;
}

function id(value: unknown, label: string): string {
  return requireBoundedString(value, label, ID_MAX);
}

function visibleText(value: unknown, label: string, maximum: number): string {
  const result = requireBoundedString(value, label, maximum);
  if (!result.trim()) invalid(`${label} must not be blank`);
  return result;
}

function text(value: unknown, label: string): string {
  if (typeof value !== "string" || value.length > TEXT_MAX) invalid(`${label} must be text`);
  return value;
}

function timestamp(value: unknown, label: string): string {
  const result = requireBoundedString(value, label, TIMESTAMP_MAX);
  if (!Number.isFinite(Date.parse(result))) invalid(`${label} must be an ISO timestamp`);
  return result;
}

function flag(value: unknown, label: string): boolean {
  if (typeof value !== "boolean") invalid(`${label} must be a boolean`);
  return value;
}

function count(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 0) invalid(`${label} must be a non-negative integer`);
  return value as number;
}

function positive(value: unknown, label: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) invalid(`${label} must be a positive integer`);
  return value as number;
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) invalid(`Invalid ${label}`);
  return value as T[number];
}

function invalid(message: string): never {
  throw new RpcError("invalid-frame", message);
}
