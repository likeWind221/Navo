import type { AgentTurnV2Event } from "../../../rpc/content.js";
import type {
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
  projectTurnMethod,
} from "../../../rpc/project.js";
import type { RpcMethod, RpcStreamOptions } from "../../../rpc/index.js";
import type { ProjectHost } from "../../electron/ipc/project/handler.js";

export class ControlledProjectHost implements ProjectHost {
  private readonly projects = new Map<string, ProjectDetailV1>();
  private readonly failFirstTurn: boolean;
  private nextId = 1;
  private revision = 0;

  constructor(options: { readonly failFirstTurn?: boolean } = {}) {
    this.failFirstTurn = options.failFirstTurn === true;
  }

  stream<TInput, TOutput>(method: RpcMethod<TInput, TOutput>, input: TInput, options?: RpcStreamOptions): AsyncIterable<TOutput> {
    if (method === projectListMethod) return this.validated(method, input, one({ projects: [...this.projects.values()].map(detail => detail.project) } as ProjectListV1), options?.signal);
    if (method === projectCreateMethod) return this.validated(method, input, one(this.create(input as ProjectCreateInput)), options?.signal);
    if (method === projectGetMethod) return this.validated(method, input, one(this.get(input as ProjectRefInput)), options?.signal);
    if (method === projectFollowMethod) return this.validated(method, input, this.follow(input as ProjectRefInput, options?.signal), options?.signal);
    if (method === projectTurnMethod) return this.validated(method, input, this.turn(input as ProjectTurnInput, options?.signal), options?.signal);
    return one(null) as AsyncIterable<TOutput>;
  }

  private validated<TInput, TOutput>(method: RpcMethod<TInput, TOutput>, input: TInput, source: AsyncIterable<unknown>, signal: AbortSignal | undefined): AsyncIterable<TOutput> {
    const validator = method.createOutputValidator?.(input);
    return (async function* () {
      try {
        for await (const value of source) yield validator === undefined ? method.parseOutput(value) : validator.parse(value);
      } finally {
        if (!signal?.aborted) validator?.end();
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
        nodes: [node("controlled-node-1", "确认目标并整理执行路线"), node("controlled-node-2", "验证路线产出")],
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
}

function node(nodeId: string, title: string) {
  return {
    nodeId, revision: 1, requirement: "required" as const, status: "idle" as const,
    title, description: title, acceptanceCriteria: ["完成并可检查"], hasSession: false, turnActive: false,
    actions: { run: true, complete: false, skip: false, rework: false, review: false },
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

