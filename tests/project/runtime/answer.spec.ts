import { describe, expect, it } from "vitest";

import { createToolCallId } from "../../../src/brand/ids.js";
import { modelResponse } from "../../helpers/runtime.js";
import { createKit } from "./helpers.js";

function call(name: string, args: unknown) {
  return modelResponse([{ type: "tool-call", id: createToolCallId(name), name,
    arguments: JSON.stringify(args) }], "tool-calls");
}

describe("Review without Resource deliverables", () => {
  it("checks an actual mailbox action without creating a Resource", async () => {
    const { ctx, adapter } = await createKit([
      call("send_to_main", { message: "已记录三个实施阶段" }),
      call("submit_completion", { summary: "已发送阶段通知", resource_ids: [],
        criteria: [{ criterion_index: 1, satisfied: true, note: "请检查当前项目 Mailbox" }], remaining: [] }),
      call("read_mailbox", {}),
      call("submit_review", { decision: "complete", reason: "Mailbox 中确实存在阶段通知" }),
      modelResponse([{ type: "text", text: "审查完成" }]),
    ]);
    const project = ctx.projects.create({ name: "Action", goal: "发送通知" });
    const node = ctx.nodes.create({ projectId: project.id, objective: {
      title: "通知", description: "向 Main 发送阶段通知", acceptanceCriteria: ["Mailbox 中有阶段通知"],
    } });
    ctx.roadmaps.create({ definition: { projectId: project.id, nodes: [node.node.id], edges: [] }, reason: "通知" });
    await ctx.projectRuntime.startNode({ projectId: project.id, nodeId: node.node.id, text: "发送通知" });
    await ctx.projectRuntime.startReview({ projectId: project.id, nodeId: node.node.id, text: "核对通知" });
    expect(ctx.resources.listByProject(project.id)).toHaveLength(0);
    expect(ctx.nodes.get(node.node.id)?.lastReview?.decision).toBe("complete");
    expect(JSON.stringify(adapter.requests[3]!.messages.at(-1))).toContain("已记录三个实施阶段");
  });

  it.each([
    { summary: "方案：先明确需求，再实现最小功能，最后验证。", decision: "complete", feedback: undefined },
    { summary: "已完成。", decision: "rework", feedback: "请提交包含三个阶段的具体方案。" },
  ])("records $decision for an answer-only task without requiring Resources or logs", async ({ summary, decision, feedback }) => {
    const { ctx, adapter } = await createKit([
      call("submit_completion", { summary, resource_ids: [],
        criteria: [{ criterion_index: 1, satisfied: true, note: "方案见提交正文" }], remaining: [] }),
      call("submit_review", { decision, reason: "直接检查提交正文是否包含三个阶段", ...(feedback ? { feedback } : {}) }),
      modelResponse([{ type: "text", text: "审查完成" }]),
    ]);
    const project = ctx.projects.create({ name: "Answer", goal: "给出方案" });
    const node = ctx.nodes.create({ projectId: project.id, objective: {
      title: "方案", description: "给出需求、实现、验证三个阶段的方案，无需文件。",
      acceptanceCriteria: ["正文包含需求、实现、验证三个阶段"],
    } });
    ctx.roadmaps.create({ definition: { projectId: project.id, nodes: [node.node.id], edges: [] }, reason: "方案" });
    await ctx.projectRuntime.startNode({ projectId: project.id, nodeId: node.node.id, text: "给出方案" });
    expect(ctx.nodes.get(node.node.id)?.status).toBe("submitted");
    expect(ctx.resources.listByProject(project.id)).toHaveLength(0);
    await ctx.projectRuntime.startReview({ projectId: project.id, nodeId: node.node.id, text: "审查方案" });
    expect(ctx.nodes.get(node.node.id)?.lastReview?.decision).toBe(decision);
    const prompt = JSON.stringify(adapter.requests[1]!.messages);
    expect(prompt).toContain("Empty resourceIds is valid");
    expect(prompt).toContain("Judge a self-contained answer directly");
    expect(prompt).toContain("current state tools for state claims");
    expect(prompt).toContain("Stop reading once each criterion has adequate support");
    expect(prompt).not.toContain("Spot-check at least one piece of evidence for every criterion");
    expect(adapter.requests).toHaveLength(3);
  });
});
