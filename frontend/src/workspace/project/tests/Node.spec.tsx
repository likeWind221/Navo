import { renderToStaticMarkup } from "react-dom/server";
import { expect, it, vi } from "vitest";
import type { NodeV1, RoadmapV1 } from "../../../../../rpc/project.js";
import { NodeDetails } from "../Node";

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
