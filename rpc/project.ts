import type { AgentTurnV2Event } from "./content.js";
import type { RpcMethod, RpcOutputValidator } from "./protocol.js";
import { RpcError } from "./errors.js";
import { agentTurnV2Method } from "./content/stream.js";
import { createProjectTurnOutputValidator } from "./project/turn.js";
import {
  parseProjectCreateInput,
  parseProjectDetail,
  parseProjectFollow,
  parseProjectList,
  parseProjectMailbox,
  parseProjectMailboxInput,
  parseProjectRefInput,
  parseProjectResources,
  parseProjectSummary,
  parseEmptyInput,
  parseNodeReviewInput,
  parseNode,
  parseProjectTurnInput,
} from "./project/validation.js";

export const projectListMethod: RpcMethod<ProjectListInput, ProjectListV1> = Object.freeze({
  name: "project.list.v1",
  parseInput: parseEmptyInput,
  parseOutput: parseProjectList,
  createOutputValidator: () => singleOutput(parseProjectList),
});

export const projectCreateMethod: RpcMethod<ProjectCreateInput, ProjectSummaryV1> = Object.freeze({
  name: "project.create.v1",
  parseInput: parseProjectCreateInput,
  parseOutput: parseProjectSummary,
  createOutputValidator: () => singleOutput(parseProjectSummary),
});

export const projectGetMethod: RpcMethod<ProjectRefInput, ProjectDetailV1> = Object.freeze({
  name: "project.get.v1",
  parseInput: parseProjectRefInput,
  parseOutput: parseProjectDetail,
  createOutputValidator: () => singleOutput(parseProjectDetail),
});

export const projectMailboxMethod: RpcMethod<ProjectMailboxInput, ProjectMailboxV1> = Object.freeze({
  name: "project.mailbox.v1",
  parseInput: parseProjectMailboxInput,
  parseOutput: parseProjectMailbox,
  createOutputValidator: () => singleOutput(parseProjectMailbox),
});

export const projectResourcesMethod: RpcMethod<ProjectRefInput, ProjectResourcesV1> = Object.freeze({
  name: "project.resources.v1",
  parseInput: parseProjectRefInput,
  parseOutput: parseProjectResources,
  createOutputValidator: () => singleOutput(parseProjectResources),
});

export const projectTurnMethod: RpcMethod<ProjectTurnInput, AgentTurnV2Event> = Object.freeze({
  name: "project.turn.v1",
  parseInput: parseProjectTurnInput,
  parseOutput: (value: unknown) => agentTurnV2Method.parseOutput(value),
  createOutputValidator: createProjectTurnOutputValidator,
});

export const projectNodeReviewMethod: RpcMethod<NodeReviewInput, NodeV1> = Object.freeze({
  name: "project.node.review.v1",
  parseInput: parseNodeReviewInput,
  parseOutput: parseNode,
  createOutputValidator: () => singleOutput(parseNode),
});

export const projectFollowMethod: RpcMethod<ProjectRefInput, ProjectFollowV1> = Object.freeze({
  name: "project.follow.v1",
  parseInput: parseProjectRefInput,
  parseOutput: parseProjectFollow,
  createOutputValidator: () => {
    let received = false;
    return {
      parse(value: unknown) {
        received = true;
        return parseProjectFollow(value);
      },
      end() {
        if (!received) throw new RpcError("invalid-output", "Project follow ended before its baseline");
      },
    };
  },
});

export type ProjectFailureCode =
  | "invalid-request"
  | "project-not-found"
  | "node-not-found"
  | "project-unavailable"
  | "turn-active"
  | "invalid-state"
  | "revision-conflict"
  | "workspace-conflict"
  | "workspace-invalid"
  | "runtime-unavailable"
  | "internal";

export type ProjectListInput = Readonly<Record<string, never>>;

export interface ProjectCreateInput {
  readonly name: string;
  readonly goal: string;
  readonly workspaceRoot: string;
}

export interface ProjectRefInput {
  readonly projectId: string;
}

export interface ProjectMailboxInput {
  readonly projectId: string;
  readonly afterSequence: number | null;
  readonly limit: number;
}

export interface ProjectTurnInput {
  readonly projectId: string;
  readonly requestId: string;
  readonly text: string;
  readonly target: ProjectTurnTarget;
}

export type ProjectTurnTarget =
  | { readonly kind: "main" }
  | { readonly kind: "node"; readonly nodeId: string };

export interface NodeReviewInput {
  readonly projectId: string;
  readonly nodeId: string;
  readonly action: "complete" | "skip";
  readonly reason: string;
  readonly reviewedRevision: number;
}

export interface ProjectListV1 {
  readonly projects: readonly ProjectSummaryV1[];
}

export interface ProjectSummaryV1 {
  readonly projectId: string;
  readonly name: string;
  readonly goal: string;
  readonly workspaceRoot: string | null;
  readonly status: "active" | "archived";
  readonly revision: number;
  readonly createdAt: string;
}

export interface ProjectDetailV1 {
  readonly project: ProjectSummaryV1;
  readonly main: ProjectMainV1;
  readonly roadmap: RoadmapV1 | null;
}

export interface ProjectFollowV1 {
  readonly detail: ProjectDetailV1;
  readonly mailboxSequence: number;
  readonly resourceRevision: number;
}

export interface ProjectMainV1 {
  readonly sessionId: string;
  readonly turnActive: boolean;
}

export interface RoadmapV1 {
  readonly revision: number;
  readonly nodes: readonly NodeV1[];
  readonly edges: readonly RoadmapEdgeV1[];
}

export interface RoadmapEdgeV1 {
  readonly from: string;
  readonly to: string;
}

export interface NodeV1 {
  readonly nodeId: string;
  readonly revision: number;
  readonly kind: "work" | "control";
  readonly requirement: "required" | "optional";
  readonly status: NodeStatusV1;
  readonly title: string;
  readonly description: string;
  readonly acceptanceCriteria: readonly string[];
  readonly controlPurpose: "start" | "end" | "checkpoint" | null;
  readonly hasSession: boolean;
  readonly turnActive: boolean;
  readonly actions: NodeActionsV1;
  readonly confirmation: NodeConfirmationV1 | null;
}

export type NodeStatusV1 = "locked" | "idle" | "working" | "completing" | "skipped";

export interface NodeActionsV1 {
  readonly run: boolean;
  readonly complete: boolean;
  readonly skip: boolean;
}

export interface NodeConfirmationV1 {
  readonly confirmedBy: string;
  readonly reason: string;
  readonly reviewedRevision: number;
}

export interface ProjectMailboxV1 {
  readonly messages: readonly ProjectMessageV1[];
  readonly nextSequence: number | null;
}

export interface ProjectMessageV1 {
  readonly messageId: string;
  readonly sequence: number;
  readonly timestamp: string;
  readonly sender: ProjectParticipantV1;
  readonly recipient: ProjectParticipantV1;
  readonly body: string;
}

export type ProjectParticipantV1 =
  | { readonly kind: "main" }
  | { readonly kind: "node"; readonly nodeId: string };

export interface ProjectResourcesV1 {
  readonly resources: readonly ProjectResourceV1[];
}

export interface ProjectResourceV1 {
  readonly resourceId: string;
  readonly owner: ProjectParticipantV1;
  readonly name: string;
  readonly description: string;
  readonly type: string;
  readonly entryRef: string;
  readonly access: ProjectResourceAccessV1;
  readonly revision: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export type ProjectResourceAccessV1 =
  | { readonly kind: "private" }
  | { readonly kind: "shared"; readonly nodeIds: readonly string[] }
  | { readonly kind: "public" };

export const PROJECT_NAME_MAX_CHARS = 80;
export const PROJECT_GOAL_MAX_CHARS = 8_000;
export const PROJECT_WORKSPACE_ROOT_MAX_CHARS = 4_096;
export const PROJECT_MAILBOX_PAGE_MAX = 100;
export const PROJECT_REVIEW_REASON_MAX_CHARS = 4_000;

function singleOutput<T>(parse: (value: unknown) => T): RpcOutputValidator<T> {
  let received = false;
  return {
    parse(value) {
      if (received) throw new RpcError("invalid-output", "Project method returns exactly one item");
      received = true;
      return parse(value);
    },
    end() {
      if (!received) throw new RpcError("invalid-output", "Project method ended without a result");
    },
  };
}
