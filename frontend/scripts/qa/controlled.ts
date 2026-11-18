import type { AgentTurnV2Event } from "../../../rpc/content.js";
import type {
  NodeV1,
  NodeReviewInput,
  ProjectCreateInput,
  ProjectDetailV1,
  ProjectFollowV1,
  ProjectListV1,
  ProjectRefInput,
  ProjectSummaryV1,
  ProjectTurnInput,
  RoadmapV1,
} from "../../../rpc/project.js";
import {
  projectCreateMethod,
  projectFollowMethod,
  projectGetMethod,
  projectListMethod,
  projectNodeReviewMethod,
  projectSessionRecoveryMethod,
  projectTurnMethod,
} from "../../../rpc/project.js";
import { sessionHistoryMethod } from "../../../rpc/session.js";
import type { SessionHistoryInputV1 } from "../../../rpc/session.js";
import type { ProjectSessionRecoveryV1 } from "../../../rpc/project/session.js";
import type { RpcMethod, RpcStreamOptions } from "../../../rpc/index.js";
import { RpcError } from "../../../rpc/errors.js";
import type { ProjectHost } from "../../electron/ipc/project/handler.js";

interface ControlledProjectHostOptions {
  readonly failFirstTurn?: boolean;
  readonly submitNodeOnFinish?: boolean;
}

export class ControlledProjectHost implements ProjectHost {
  private readonly projects = new Map<string, ProjectDetailV1>();
  private readonly failFirstTurn: boolean;
  private readonly submitNodeOnFinish: boolean;
  readonly turnInputs: ProjectTurnInput[] = [];
  readonly reviewInputs: NodeReviewInput[] = [];
  readonly abortedTargets: ProjectTurnInput["target"][] = [];
  private nextId = 1;
  private revision = 0;
  private failNextReview = false;
  private reviewDelayMs = 0;

  constructor(options: ControlledProjectHostOptions = {}) {
    this.failFirstTurn = options.failFirstTurn === true;
    this.submitNodeOnFinish = options.submitNodeOnFinish === true;
  }

  stream<TInput, TOutput>(method: RpcMethod<TInput, TOutput>, input: TInput, options?: RpcStreamOptions): AsyncIterable<TOutput> {
    if (method.name === projectListMethod.name) return this.validated(method, input, one({ projects: [...this.projects.values()].map(detail => detail.project) } as ProjectListV1), options?.signal);
    if (method.name === projectCreateMethod.name) return this.validated(method, input, one(this.create(input as ProjectCreateInput)), options?.signal);
    if (method.name === projectGetMethod.name) return this.validated(method, input, one(this.get(input as ProjectRefInput)), options?.signal);
    if (method.name === projectSessionRecoveryMethod.name) {
      const { projectId } = input as ProjectRefInput;
      const detail = this.get({ projectId });
      const sessions: ProjectSessionRecoveryV1["sessions"] = (detail.roadmap?.nodes ?? []).map(node => {
        const owner = { kind: "node" as const, nodeId: node.nodeId };
        return node.hasSession
          ? { owner, status: "available", sessionId: `controlled-session-${projectId}-${node.nodeId}`, lastEndedTurn: null }
          : { owner, status: "unestablished" };
      });
      return this.validated(method, input, one({ projectId, sessions }), options?.signal);
    }
    if (method.name === sessionHistoryMethod.name) {
      const { sessionId } = input as SessionHistoryInputV1;
      return this.validated(method, input, one({ sessionId, surfaceGeneration: 0, entries: [], nextCursor: null }), options?.signal);
    }
    if (method.name === projectNodeReviewMethod.name) return this.validated(method, input, this.review(input as NodeReviewInput), options?.signal);
    if (method.name === projectFollowMethod.name) return this.validated(method, input, this.follow(input as ProjectRefInput, options?.signal), options?.signal);
    if (method.name === projectTurnMethod.name) return this.validated(method, input, this.turn(input as ProjectTurnInput, options?.signal), options?.signal);
    return one(null) as AsyncIterable<TOutput>;
  }

  rejectNextReview(): void {
    this.failNextReview = true;
  }

  setReviewDelay(ms: number): void {
    this.reviewDelayMs = ms;
  }

  private validated<TInput, TOutput>(method: RpcMethod<TInput, TOutput>, input: TInput, source: AsyncIterable<unknown>, signal: AbortSignal | undefined): AsyncIterable<TOutput> {
    const validator = method.createOutputValidator?.(input);
    return (async function* () {
      let completed = false;
      try {
        for await (const value of source) yield validator === undefined ? method.parseOutput(value) : validator.parse(value);
        completed = true;
      } finally {
        if (completed && !signal?.aborted) validator?.end();
      }
    })();
  }

  private create(input: ProjectCreateInput): ProjectSummaryV1 {
    const projectId = "controlled-project-" + this.nextId++;
    const summary: ProjectSummaryV1 = {
      projectId, name: input.name, goal: input.goal, workspaceRoot: input.workspaceRoot,
      status: "active", revision: 1, createdAt: new Date().toISOString(),
    };
    this.projects.set(projectId, { project: summary, main: { sessionId: "controlled-session-" + projectId, turnActive: false }, roadmap: null });
    return summary;
  }

  private get(input: ProjectRefInput): ProjectDetailV1 {
    const detail = this.projects.get(input.projectId);
    if (detail === undefined) throw new Error("Unknown controlled project");
    return detail;
  }

  private async *follow(input: ProjectRefInput, signal: AbortSignal | undefined): AsyncGenerator<ProjectFollowV1> {
    let sentRevision = -1;
    while (!signal?.aborted) {
      const detail = this.get(input);
      if (detail.project.revision !== sentRevision) {
        sentRevision = detail.project.revision;
        yield { detail, mailboxSequence: sentRevision, resourceRevision: sentRevision };
      }
      await delay(40);
    }
  }

  private async *turn(input: ProjectTurnInput, signal: AbortSignal | undefined): AsyncGenerator<AgentTurnV2Event> {
    this.turnInputs.push(input);
    if (input.target.kind === "node") {
      yield* this.nodeTurn(input, input.target.nodeId, signal);
      return;
    }
    if (input.target.kind === "review") {
      yield* this.reviewTurn(input, input.target.nodeId, signal);
      return;
    }
    let detail = this.get(input);
    const turnId = "controlled-turn-" + (++this.revision);
    const fail = this.failFirstTurn && this.revision === 1;
    detail = { ...detail, main: { ...detail.main, turnActive: true } };
    this.projects.set(input.projectId, detail);
    yield { type: "turn-started", sessionId: detail.main.sessionId, requestId: input.requestId, turnId };
    yield {
      type: "step-started", sessionId: detail.main.sessionId, requestId: input.requestId,
      turnId, stepId: "controlled-step", messageId: "controlled-message",
    };
    yield {
      type: "content-started", sessionId: detail.main.sessionId, requestId: input.requestId,
      turnId, stepId: "controlled-step", messageId: "controlled-message", contentIndex: 0, kind: "text",
    };
    yield {
      type: "content-delta", sessionId: detail.main.sessionId, requestId: input.requestId,
      turnId, stepId: "controlled-step", messageId: "controlled-message", contentIndex: 0,
      delta: detail.project.goal === null ? "已复述本轮提出的本地文件夹与逻辑资料夹整理目标，等待明确确认。" : "已复述当前目标，等待明确确认。",
    };
    yield {
      type: "content-completed", sessionId: detail.main.sessionId, requestId: input.requestId,
      turnId, stepId: "controlled-step", messageId: "controlled-message", contentIndex: 0,
    };
    yield {
      type: "step-completed", sessionId: detail.main.sessionId, requestId: input.requestId,
      turnId, stepId: "controlled-step", messageId: "controlled-message",
    };
    if (fail) {
      detail = { ...detail, main: { ...detail.main, turnActive: false } };
      this.projects.set(input.projectId, detail);
      yield {
        type: "turn-failed", sessionId: detail.main.sessionId, requestId: input.requestId,
        turnId, failure: { code: "controlled-failure", message: "受控首回合失败" },
      };
      return;
    }
    if (input.text.trim().startsWith("停止前")) {
      await abort(signal);
      const current = this.get(input);
      this.projects.set(input.projectId, { ...current, main: { ...current.main, turnActive: false } });
      return;
    }
    if (input.text.trim().startsWith("我确认")) {
      const goal = detail.project.goal ?? "比较本地文件夹与逻辑资料夹的整理方式，按上手成本和维护成本给出短文建议；不联网、不执行 Shell 或文件操作。";
      const roadmap: RoadmapV1 = {
        revision: 1,
        nodes: [
          node("controlled-node-1", "确认目标并整理执行路线"),
          node("controlled-node-2", "验证路线产出", "locked"),
        ],
        edges: [{ from: "controlled-node-1", to: "controlled-node-2" }],
      };
      detail = { ...detail, project: { ...detail.project, goal, revision: detail.project.revision + 1 }, roadmap };
      this.projects.set(input.projectId, detail);
    }
    detail = { ...detail, main: { ...detail.main, turnActive: false } };
    this.projects.set(input.projectId, detail);
    yield { type: "turn-completed", sessionId: detail.main.sessionId, requestId: input.requestId, turnId };
    void signal;
  }

  private async *nodeTurn(input: ProjectTurnInput, nodeId: string, signal: AbortSignal | undefined): AsyncGenerator<AgentTurnV2Event> {
    let detail = this.get(input);
    const current = detail.roadmap?.nodes.find(item => item.nodeId === nodeId);
    if (current === undefined) throw new Error("Unknown controlled node");
    if (!current.actions.run) throw new Error("Controlled node does not allow execution");
    const turnId = "controlled-turn-" + (++this.revision);
    const sessionId = "controlled-session-" + input.projectId + "-" + current.nodeId;
    detail = this.saveNode(detail, current.nodeId, {
      ...current,
      status: "working",
      turnActive: true,
      actions: { ...current.actions, run: false },
    });
    try {
      yield { type: "turn-started", sessionId, requestId: input.requestId, turnId };
      await delay(250);
      yield {
        type: "step-started", sessionId, requestId: input.requestId,
        turnId, stepId: "controlled-node-step", messageId: "controlled-node-message",
      };
      yield {
        type: "content-started", sessionId, requestId: input.requestId,
        turnId, stepId: "controlled-node-step", messageId: "controlled-node-message", contentIndex: 0, kind: "text",
      };
      yield {
        type: "content-delta", sessionId, requestId: input.requestId,
        turnId, stepId: "controlled-node-step", messageId: "controlled-node-message", contentIndex: 0,
        delta: "节点执行完成，当前运行期间的会话与状态已保留。",
      };
      yield {
        type: "content-completed", sessionId, requestId: input.requestId,
        turnId, stepId: "controlled-node-step", messageId: "controlled-node-message", contentIndex: 0,
      };
      yield {
        type: "step-completed", sessionId, requestId: input.requestId,
        turnId, stepId: "controlled-node-step", messageId: "controlled-node-message",
      };
      if (input.text.trim().startsWith("停止前")) {
        await abort(signal);
        return;
      }
      this.finishNode(input.projectId, nodeId, current);
      yield { type: "turn-completed", sessionId, requestId: input.requestId, turnId };
    } finally {
      if (signal?.aborted) {
        this.abortedTargets.push(input.target);
        this.finishNode(input.projectId, nodeId, current);
      }
    }
  }

  private async *reviewTurn(input: ProjectTurnInput, nodeId: string, signal: AbortSignal | undefined): AsyncGenerator<AgentTurnV2Event> {
    const detail = this.get(input);
    const current = detail.roadmap?.nodes.find(item => item.nodeId === nodeId);
    if (current === undefined) throw new Error("Unknown controlled node");
    if (!current.actions.review) throw new Error("Controlled node does not allow Main review");
    const turnId = "controlled-turn-" + (++this.revision);
    const sessionId = detail.main.sessionId;
    yield { type: "turn-started", sessionId, requestId: input.requestId, turnId };
    await delay(250);
    if (signal?.aborted) return;
    yield {
      type: "step-started", sessionId, requestId: input.requestId,
      turnId, stepId: "controlled-review-step", messageId: "controlled-review-message",
    };
    yield {
      type: "content-started", sessionId, requestId: input.requestId,
      turnId, stepId: "controlled-review-step", messageId: "controlled-review-message", contentIndex: 0, kind: "text",
    };
    yield {
      type: "content-delta", sessionId, requestId: input.requestId,
      turnId, stepId: "controlled-review-step", messageId: "controlled-review-message", contentIndex: 0,
      delta: "复盘完成：证据链仍不完整，已退回 Node 补充 2024 年来源。",
    };
    yield {
      type: "content-completed", sessionId, requestId: input.requestId,
      turnId, stepId: "controlled-review-step", messageId: "controlled-review-message", contentIndex: 0,
    };
    yield {
      type: "step-completed", sessionId, requestId: input.requestId,
      turnId, stepId: "controlled-review-step", messageId: "controlled-review-message",
    };
    const reviewedAt = new Date().toISOString();
    this.saveNode(detail, nodeId, {
      ...current,
      status: "idle",
      submission: null,
      reviewPending: false,
      reworkCount: current.reworkCount + 1,
      review: {
        decision: "rework",
        reason: "证据链仍不完整",
        turnId,
        reviewedRevision: current.revision,
        reviewedAt,
      },
      pendingFeedback: {
        requestedBy: "main",
        feedback: "补充 2024 年来源后重新提交。",
        reviewedRevision: current.revision,
        requestedAt: reviewedAt,
      },
      actions: { ...current.actions, run: true, complete: true, skip: true, rework: false },
    });
    yield { type: "turn-completed", sessionId, requestId: input.requestId, turnId };
  }

  private async *review(input: NodeReviewInput): AsyncGenerator<NodeV1> {
    this.reviewInputs.push(input);
    if (this.reviewDelayMs > 0) await delay(this.reviewDelayMs);
    if (this.failNextReview) {
      this.failNextReview = false;
      const detail = this.get(input);
      const current = detail.roadmap?.nodes.find(item => item.nodeId === input.nodeId);
      if (current !== undefined && current.submission !== null) {
        this.saveNode(detail, current.nodeId, {
          ...current,
          revision: current.revision + 1,
          submission: { ...current.submission, summary: "另一份最新作业版本" },
        });
      }
      throw new RpcError("remote-error", "节点版本已变化", {
        failure: { code: "revision-conflict", message: "节点版本已变化，请查看最新作业。", details: {} },
      });
    }
    const detail = this.get(input);
    const current = detail.roadmap?.nodes.find(item => item.nodeId === input.nodeId);
    if (current === undefined) throw new Error("Unknown controlled node");
    if (current.revision !== input.reviewedRevision) {
      throw new RpcError("remote-error", "节点版本已变化", {
        failure: { code: "revision-conflict", message: "节点版本已变化，请查看最新作业。", details: {} },
      });
    }
    if (!current.actions[input.action]) throw new Error("Controlled review action is not allowed");
    if (input.action === "rework") {
      const requestedAt = new Date().toISOString();
      const next = {
        ...current,
        status: "idle" as const,
        submission: null,
        confirmation: null,
        reviewPending: false,
        reworkCount: current.reworkCount + 1,
        pendingFeedback: {
          requestedBy: "human",
          feedback: input.reason,
          reviewedRevision: input.reviewedRevision,
          requestedAt,
        },
        actions: { ...current.actions, run: true, complete: true, skip: true, rework: false, review: true },
      };
      this.saveNode(detail, current.nodeId, next);
      yield next;
      return;
    }
    if (input.action === "skip") {
      const next: NodeV1 = {
        ...current,
        status: "skipped",
        confirmation: { confirmedBy: "human", reason: input.reason, reviewedRevision: input.reviewedRevision },
        reviewPending: false,
        actions: { run: false, complete: false, skip: false, rework: false, review: false },
      };
      this.saveNode(detail, current.nodeId, next);
      yield next;
      return;
    }
    const completed: NodeV1 = {
      ...current,
      status: "completing",
      confirmation: { confirmedBy: "human", reason: input.reason, reviewedRevision: input.reviewedRevision },
      reviewPending: false,
      actions: { run: false, complete: false, skip: false, rework: false, review: false },
    };
    const nodes = [completed];
    for (const edge of detail.roadmap?.edges ?? []) {
      if (edge.from !== current.nodeId) continue;
      const successor = detail.roadmap?.nodes.find(item => item.nodeId === edge.to);
      if (successor?.status === "locked") {
        nodes.push({
          ...successor,
          revision: successor.revision + 1,
          status: "idle",
          actions: { ...successor.actions, run: true, review: true },
        });
      }
    }
    this.saveNodes(detail, nodes);
    yield completed;
  }

  private saveNode(detail: ProjectDetailV1, nodeId: string, nodeValue: NodeV1): ProjectDetailV1 {
    return this.saveNodes(detail, [nodeValue]);
  }

  private saveNodes(detail: ProjectDetailV1, values: readonly NodeV1[]): ProjectDetailV1 {
    if (detail.roadmap === null) throw new Error("Controlled node turn requires a roadmap");
    const replacements = new Map(values.map(nodeValue => [nodeValue.nodeId, nodeValue]));
    const next = {
      ...detail,
      project: { ...detail.project, revision: detail.project.revision + 1 },
      roadmap: {
        ...detail.roadmap,
        nodes: detail.roadmap.nodes.map(item => replacements.get(item.nodeId) ?? item),
      },
    };
    this.projects.set(detail.project.projectId, next);
    return next;
  }

  private finishNode(projectId: string, nodeId: string, original: NodeV1): void {
    const detail = this.projects.get(projectId);
    const current = detail?.roadmap?.nodes.find(item => item.nodeId === nodeId);
    if (detail === undefined || current === undefined || !current.turnActive) return;
    this.saveNode(detail, nodeId, this.submitNodeOnFinish ? {
      ...original,
      status: "submitted",
      hasSession: true,
      turnActive: false,
      reviewPending: true,
      submission: {
        summary: "完成资料整理并保留出处",
        resourceIds: ["controlled-resource-1"],
        criteria: [
          { criterion: "完成并可检查", satisfied: true, note: "产物已关联" },
          { criterion: "保留来源", satisfied: false, note: "尚缺 2024 年来源" },
        ],
        remaining: ["补充 2024 年来源"],
        submittedAt: new Date().toISOString(),
      },
      pendingFeedback: null,
      review: null,
      actions: { run: false, complete: true, skip: true, rework: true, review: true },
    } : {
      ...original,
      status: "idle",
      hasSession: true,
      turnActive: false,
      actions: { ...original.actions, run: true },
    });
  }
}

function node(nodeId: string, title: string, status: "idle" | "locked" = "idle"): NodeV1 {
  return {
    nodeId, revision: 1, requirement: "required" as const, status,
    title, description: title, acceptanceCriteria: ["完成并可检查"], hasSession: false, turnActive: false,
    actions: { run: status === "idle", complete: false, skip: false, rework: false, review: false },
    confirmation: null, submission: null, pendingFeedback: null, review: null,
    reworkCount: 0, reviewPending: false,
  };
}

async function* one<T>(value: T): AsyncGenerator<T> { yield value; }

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function abort(signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.resolve();
  return new Promise(resolve => signal?.addEventListener("abort", () => resolve(), { once: true }));
}

