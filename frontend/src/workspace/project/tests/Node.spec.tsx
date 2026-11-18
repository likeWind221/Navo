import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { NodeV1, RoadmapV1 } from "../../../../../rpc/project.js";
import { NodeDetails, nodeHasSubmission } from "../Node";
import type { NodeReviewControls } from "../node/Review";

const node: NodeV1 = {
  nodeId: "a", title: "任务 A", description: "目标", acceptanceCriteria: ["保留证据"], requirement: "optional", revision: 1, status: "idle", hasSession: false, turnActive: false,
  actions: { run: false, complete: false, skip: false, rework: false, review: false }, confirmation: null, submission: null, pendingFeedback: null, review: null, reworkCount: 0, reviewPending: false,
};

it("shows authoritative actions instead of deriving permission from idle status", () => {
  const roadmap: RoadmapV1 = { revision: 1, nodes: [node], edges: [] };
  const markup = renderToStaticMarkup(<NodeDetails node={node} roadmap={roadmap} onOpen={vi.fn()} />);
  expect(markup).toContain("可执行");
  expect(markup).toContain("可选节点");
  expect(markup).toContain("保留证据");
  expect(markup).toContain("当前没有可用操作");
  expect(markup).not.toContain("开始或继续执行");
});

it("keeps execution closed when another action exists but run is not allowed", () => {
  const blocked: NodeV1 = { ...node, actions: { ...node.actions, skip: true } };
  const roadmap: RoadmapV1 = { revision: 1, nodes: [blocked], edges: [] };
  const markup = renderToStaticMarkup(<NodeDetails node={blocked} roadmap={roadmap} onOpen={vi.fn()} />);
  expect(markup).toContain("跳过节点");
  expect(markup).toContain("执行入口需等待后端允许");
  expect(markup).not.toContain("执行入口已开放");
});

it("opens execution guidance only when the authoritative action allows running", () => {
  const runnable: NodeV1 = { ...node, actions: { ...node.actions, run: true } };
  const roadmap: RoadmapV1 = { revision: 1, nodes: [runnable], edges: [] };
  const markup = renderToStaticMarkup(<NodeDetails node={runnable} roadmap={roadmap} onOpen={vi.fn()} />);
  expect(markup).toContain("执行入口已开放");
  expect(markup).not.toContain("执行入口需等待后端允许");
});

it("distinguishes submitted from completed and exposes current dependency titles", () => {
  const submitted: NodeV1 = { ...node, status: "submitted", actions: { ...node.actions, complete: true, rework: true } };
  const roadmap: RoadmapV1 = { revision: 2, nodes: [{ ...node, nodeId: "parent", title: "新前置标题" }, submitted], edges: [{ from: "parent", to: "a" }] };
  const markup = renderToStaticMarkup(<NodeDetails node={submitted} roadmap={roadmap} onOpen={vi.fn()} />);
  expect(markup).toContain("待验收");
  expect(markup).not.toContain("已完成");
  expect(markup).toContain("新前置标题");
  expect(markup).toContain("确认完成");
  expect(markup).toContain("退回修改");
});

it("shows the submitted work, checks, remaining items, feedback and review facts", () => {
  const submitted: NodeV1 = {
    ...node,
    status: "submitted",
    revision: 4,
    actions: { run: false, complete: true, skip: true, rework: true, review: true },
    submission: {
      summary: "完成资料整理并保留出处",
      resourceIds: ["resource-report"],
      criteria: [{ criterion: "保留证据", satisfied: true, note: "出处已归档" }, { criterion: "覆盖 2024", satisfied: false, note: "尚缺一篇" }],
      remaining: ["补充 2024 年数据"],
      submittedAt: "2026-11-17T01:02:03.000Z",
    },
    pendingFeedback: {
      requestedBy: "main",
      feedback: "补上 2024 年来源",
      reviewedRevision: 3,
      requestedAt: "2026-11-17T01:03:04.000Z",
    },
    review: {
      decision: "rework",
      reason: "证据覆盖不完整",
      turnId: "review-turn",
      reviewedRevision: 3,
      reviewedAt: "2026-11-17T01:03:04.000Z",
    },
    confirmation: { confirmedBy: "human", reason: "上一轮人工判断", reviewedRevision: 2 },
    reworkCount: 2,
    reviewPending: true,
  };
  const roadmap: RoadmapV1 = { revision: 3, nodes: [submitted], edges: [] };
  const controls: NodeReviewControls = {
    busy: false,
    failure: null,
    mainReviewBusy: false,
    onReview: vi.fn(async () => true),
    onAskMain: vi.fn(),
    onDismissFailure: vi.fn(),
  };
  const markup = renderToStaticMarkup(<NodeDetails node={submitted} roadmap={roadmap} onOpen={vi.fn()} review={controls} />);

  expect(markup).toContain("待复盘");
  expect(markup).toContain("已返工 2 次");
  expect(markup).toContain("补上 2024 年来源");
  expect(markup).toContain("完成资料整理并保留出处");
  expect(markup).toContain("resource-report");
  expect(markup).toContain("出处已归档");
  expect(markup).toContain("补充 2024 年数据");
  expect(markup).toContain("证据覆盖不完整");
  expect(markup).toContain("上一轮人工判断");
  expect(markup).not.toContain("已完成");
  expect(buttonTag(markup, "complete")).not.toContain("disabled");
  expect(buttonTag(markup, "review")).not.toContain("disabled");
});

it("keeps every acceptance control disabled when the backend does not expose it", () => {
  const submitted: NodeV1 = { ...node, status: "submitted", reviewPending: true };
  const roadmap: RoadmapV1 = { revision: 1, nodes: [submitted], edges: [] };
  const controls: NodeReviewControls = {
    busy: false,
    failure: null,
    mainReviewBusy: true,
    onReview: vi.fn(async () => true),
    onAskMain: vi.fn(),
    onDismissFailure: vi.fn(),
  };
  const markup = renderToStaticMarkup(<NodeDetails node={submitted} roadmap={roadmap} onOpen={vi.fn()} review={controls} />);

  expect(markup).toContain("Main 正在复盘");
  for (const action of ["complete", "rework", "skip", "review"]) {
    expect(buttonTag(markup, action)).toContain("disabled");
  }
});

it("shows the review card only after a completion has been submitted", () => {
  const submission: NonNullable<NodeV1["submission"]> = { summary: "已完成", resourceIds: [], criteria: [], remaining: [], submittedAt: "2026-11-17T01:02:03.000Z" };
  expect(nodeHasSubmission({ ...node, reviewPending: true })).toBe(false);
  expect(nodeHasSubmission({ ...node, status: "working", submission })).toBe(false);
  expect(nodeHasSubmission({ ...node, status: "submitted", submission })).toBe(true);
  expect(nodeHasSubmission({ ...node, status: "idle", pendingFeedback: { requestedBy: "human", feedback: "修改", reviewedRevision: 1, requestedAt: "2026-11-17T01:02:03.000Z" } })).toBe(false);
});

function buttonTag(markup: string, action: string): string {
  return markup.match(new RegExp('<button[^>]*data-action="' + action + '"[^>]*>'))?.[0] ?? "";
}
