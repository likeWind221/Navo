import { describe, expect, it } from "vitest";

import { createToolCallId } from "../../../src/brand/ids.js";
import type { ToolCallContentBlock } from "../../../src/llm/types.js";
import { SUBMIT_COMPLETION_TOOL_NAME } from "../../../src/tools/builtins/node/submit.js";
import { SUBMIT_REVIEW_TOOL_NAME } from "../../../src/tools/builtins/project/review.js";
import { modelResponse } from "../../helpers/runtime.js";
import { createKit, createWorkNode, flushUntil } from "./helpers.js";

function call(id: string, name: string, arguments_: unknown): ToolCallContentBlock {
  return { type: "tool-call", id: createToolCallId(id), name, arguments: JSON.stringify(arguments_) };
}

function submit(id: string) {
  return modelResponse([call(id, SUBMIT_COMPLETION_TOOL_NAME, {
    summary: "Work submitted",
    resource_ids: [],
    criteria: [{ criterion_index: 1, satisfied: true, note: "Checked" }],
    remaining: [],
  })], "tool-calls");
}

function review(id: string, decision: "complete" | "rework" | "skip" | "escalate", feedback?: string) {
  return modelResponse([call(id, SUBMIT_REVIEW_TOOL_NAME, {
    decision,
    reason: "Reviewed the Node work",
    ...(feedback === undefined ? {} : { feedback }),
  })], "tool-calls");
}

const text = (value = "Done.") => modelResponse([{ type: "text", text: value }]);

describe("F11.1 AutoRun minimal loop", () => {
  it("runs one Node through multiple Turns in the same Session before automatic Main review", async () => {
    const { ctx, adapter } = await createKit([
      text("I need another Turn."),
      submit("submit"),
      review("approve", "complete"),
      text("Reviewed."),
    ]);
    const project = ctx.projects.create({ name: "Project", goal: "Finish one task" });
    const id = createWorkNode(ctx, project.id, "Collect").node.id;
    ctx.roadmaps.create({
      definition: { projectId: project.id, nodes: [id], edges: [] },
      reason: "Approved by Human",
    });

    const result = await ctx.autoRun.start(project.id);
    expect(result).toMatchObject({
      projectId: project.id,
      status: "completed",
      reason: "roadmap-complete",
      nodeTurns: 2,
      mainTurns: 1,
    });
    expect(ctx.autoRun.get(project.id)).toBeUndefined();
    expect(ctx.nodes.get(id)).toMatchObject({ status: "completing", lastReview: { decision: "complete" } });
    const nodeSession = ctx.nodes.get(id)!.sessionId;
    expect(nodeSession).toBeDefined();
    expect(ctx.sessions.getEvents(nodeSession!).filter(event => event.type === "turn-started")).toHaveLength(2);
    expect(adapter.requests).toHaveLength(4);
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain("I need another Turn.");
    expect(JSON.stringify(adapter.requests[2]?.messages)).toContain("review checklist");
  });

  it("advances a dependency chain after Main confirms each submission", async () => {
    const { ctx } = await createKit([
      submit("first"),
      review("approve-first", "complete"),
      text(),
      submit("second"),
      review("approve-second", "complete"),
      text(),
    ]);
    const project = ctx.projects.create({ name: "Project", goal: "Complete two tasks" });
    const first = createWorkNode(ctx, project.id, "Collect").node.id;
    const second = createWorkNode(ctx, project.id, "Write").node.id;
    ctx.roadmaps.create({
      definition: { projectId: project.id, nodes: [first, second], edges: [{ from: first, to: second }] },
      reason: "Approved by Human",
    });
    expect(ctx.nodes.get(second)?.status).toBe("locked");

    const result = await ctx.autoRun.start(project.id);
    expect(result).toMatchObject({ status: "completed", nodeTurns: 2, mainTurns: 2 });
    expect(ctx.nodes.get(first)?.status).toBe("completing");
    expect(ctx.nodes.get(second)?.status).toBe("completing");
  });

  it("reuses the Node Session when Main requests rework", async () => {
    const { ctx, adapter } = await createKit([
      submit("first-submit"),
      review("return", "rework", "Add the missing source"),
      text(),
      submit("resubmit"),
      review("approve", "complete"),
      text(),
    ]);
    const project = ctx.projects.create({ name: "Project", goal: "Verify rework" });
    const id = createWorkNode(ctx, project.id, "Collect").node.id;
    ctx.roadmaps.create({ definition: { projectId: project.id, nodes: [id], edges: [] }, reason: "Approved" });

    const result = await ctx.autoRun.start(project.id);
    expect(result).toMatchObject({ status: "completed", nodeTurns: 2, mainTurns: 2 });
    const node = ctx.nodes.get(id)!;
    expect(node).toMatchObject({ status: "completing", reworkCount: 1 });
    expect(ctx.sessions.getEvents(node.sessionId!).filter(event => event.type === "turn-started")).toHaveLength(2);
    expect(JSON.stringify(adapter.requests[3]?.messages)).toContain("Add the missing source");
  });

  it("rejects duplicate AutoRuns and leaves Human Turn cancellation intact", async () => {
    const { ctx, adapter } = await createKit([{ kind: "hang" }]);
    const project = ctx.projects.create({ name: "Project", goal: "Avoid duplicate runs" });
    const id = createWorkNode(ctx, project.id, "Collect").node.id;
    ctx.roadmaps.create({ definition: { projectId: project.id, nodes: [id], edges: [] }, reason: "Approved" });

    const running = ctx.autoRun.start(project.id);
    await flushUntil(() => adapter.requests.length === 1);
    expect(ctx.autoRun.get(project.id)).toMatchObject({ projectId: project.id, status: "running" });
    expect(() => ctx.autoRun.start(project.id)).toThrow(expect.objectContaining({ code: "auto-run-active" }));
    expect(ctx.projectRuntime.stopNode(project.id, id)).toBe(true);
    const result = await running;
    expect(result).toMatchObject({ status: "stopped", reason: "turn-stopped" });
    expect(ctx.autoRun.get(project.id)).toBeUndefined();
    expect(ctx.projectRuntime.canContinueNode(project.id, id)).toBe(true);
  });

  it("does not endlessly retry a submitted Node when Main escalates or omits a decision", async () => {
    const escalated = await createKit([
      submit("submit"),
      review("escalate", "escalate"),
      text(),
    ]);
    const project = escalated.ctx.projects.create({ name: "Project", goal: "Escalate" });
    const id = createWorkNode(escalated.ctx, project.id, "Collect").node.id;
    escalated.ctx.roadmaps.create({ definition: { projectId: project.id, nodes: [id], edges: [] }, reason: "Approved" });
    const result = await escalated.ctx.autoRun.start(project.id);
    expect(result).toMatchObject({ status: "stopped", reason: "review-escalated", nodeTurns: 1, mainTurns: 1 });
    expect(escalated.ctx.nodes.get(id)?.status).toBe("submitted");

    const undecided = await createKit([submit("submit-again"), text("Looks good.")]);
    const other = undecided.ctx.projects.create({ name: "Project", goal: "No review" });
    const otherId = createWorkNode(undecided.ctx, other.id, "Collect").node.id;
    undecided.ctx.roadmaps.create({ definition: { projectId: other.id, nodes: [otherId], edges: [] }, reason: "Approved" });
    const missing = await undecided.ctx.autoRun.start(other.id);
    expect(missing).toMatchObject({ status: "stopped", reason: "review-undecided", nodeTurns: 1, mainTurns: 1 });
    expect(undecided.ctx.nodes.get(otherId)?.status).toBe("submitted");
  });

  it("requires a Goal and an existing Roadmap before starting", async () => {
    const { ctx } = await createKit([]);
    const project = ctx.projects.create({ name: "No plan", goal: null });
    expect(() => ctx.autoRun.start(project.id)).toThrow(expect.objectContaining({ code: "auto-run-unavailable" }));
    expect(ctx.autoRun.get(project.id)).toBeUndefined();
  });
});
