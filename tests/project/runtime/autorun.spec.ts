import { describe, expect, it } from "vitest";

import { createToolCallId } from "../../../src/brand/ids.js";
import type { ToolCallContentBlock } from "../../../src/llm/types.js";
import { SUBMIT_COMPLETION_TOOL_NAME } from "../../../src/tools/builtins/node/submit.js";
import { SUBMIT_REVIEW_TOOL_NAME } from "../../../src/tools/builtins/project/review.js";
import { ADD_NODE_TOOL_NAME } from "../../../src/tools/builtins/roadmap/modify.js";
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

  it("lets Main replan during review and AutoRun follows the new Roadmap", async () => {
    const { ctx } = await createKit([
      submit("submit"),
      review("approve", "complete"),
      modelResponse([
        call("add-node", ADD_NODE_TOOL_NAME, {
          base_version: 1,
          reason: "The completed work revealed a missing validation step.",
          key: "validate",
          title: "Validate",
          goal: "Validate the completed work",
          done_when: ["Validation complete"],
          required: true,
          depends_on: [],
          index: null,
        }),
      ], "tool-calls"),
      text("Plan updated."),
      submit("validate"),
      review("approve-validation", "complete"),
      text(),
    ]);
    const project = ctx.projects.create({ name: "Project", goal: "Adapt the plan" });
    const first = createWorkNode(ctx, project.id, "Collect").node.id;
    ctx.roadmaps.create({
      definition: { projectId: project.id, nodes: [first], edges: [] },
      reason: "Approved",
    });

    const result = await ctx.autoRun.start(project.id);
    const roadmap = ctx.roadmaps.get(project.id)!;
    const added = roadmap.graph.definition.nodes.find(nodeId => nodeId !== first);
    expect(added).toBeDefined();
    expect(result).toMatchObject({ status: "completed", nodeTurns: 2, mainTurns: 2 });
    expect(ctx.nodes.get(first)?.lastReview?.decision).toBe("complete");
    expect(ctx.nodes.get(added!)?.lastReview?.decision).toBe("complete");
  });

  it("continues a Node already started by Human without rebinding its Session", async () => {
    const { ctx, adapter } = await createKit([
      text("I have started the work."),
      submit("complete-later"),
      review("approve", "complete"),
      text(),
    ]);
    const project = ctx.projects.create({ name: "Project", goal: "Continue existing work" });
    const id = createWorkNode(ctx, project.id, "Collect").node.id;
    ctx.roadmaps.create({ definition: { projectId: project.id, nodes: [id], edges: [] }, reason: "Approved" });
    const manual = await ctx.projectRuntime.startNode({ projectId: project.id, nodeId: id, text: "Human start" });
    const result = await ctx.autoRun.start(project.id);
    expect(result).toMatchObject({ status: "completed", nodeTurns: 1, mainTurns: 1 });
    expect(ctx.nodes.get(id)?.sessionId).toBe(manual.sessionId);
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain("I have started the work.");
  });

  it("honors Main skip as a terminal Roadmap decision", async () => {
    const { ctx } = await createKit([
      submit("submit"),
      review("skip", "skip"),
      text(),
    ]);
    const project = ctx.projects.create({ name: "Project", goal: "Skip unnecessary work" });
    const id = createWorkNode(ctx, project.id, "Optional").node.id;
    ctx.roadmaps.create({ definition: { projectId: project.id, nodes: [id], edges: [] }, reason: "Approved" });
    const result = await ctx.autoRun.start(project.id);
    expect(result).toMatchObject({ status: "completed", nodeTurns: 1, mainTurns: 1 });
    expect(ctx.nodes.get(id)?.status).toBe("skipped");
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
    expect(result).toMatchObject({ status: "paused", reason: "turn-cancelled" });
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

  it("pauses at a Turn boundary and resumes with a fresh AutoRun budget", async () => {
    const first = {
      ...text("Pause after this Turn."),
      eventDelayMs: 20,
    };
    const { ctx, adapter } = await createKit([
      first,
      submit("submit-after-resume"),
      review("approve-after-resume", "complete"),
      text(),
    ]);
    const project = ctx.projects.create({ name: "Project", goal: "Pause safely" });
    const id = createWorkNode(ctx, project.id, "Collect").node.id;
    ctx.roadmaps.create({ definition: { projectId: project.id, nodes: [id], edges: [] }, reason: "Approved" });

    const running = ctx.autoRun.start(project.id);
    await flushUntil(() => adapter.requests.length === 1);
    const requested = ctx.autoRun.pause(project.id);
    expect(requested).toMatchObject({ status: "running", nodeTurns: 0, mainTurns: 0 });

    const paused = await running;
    expect(paused).toMatchObject({
      status: "paused",
      reason: "human-paused",
      nodeTurns: 1,
      mainTurns: 0,
    });
    expect(ctx.autoRun.get(project.id)).toMatchObject(paused);

    const resumed = await ctx.autoRun.resume(project.id);
    expect(resumed.status).toBe("completed");
    expect(resumed.runId).not.toBe(paused.runId);
    expect(resumed.nodeTurns).toBe(1);
    expect(resumed.mainTurns).toBe(1);
  });

  it("pauses at the Node Turn budget without starting another Turn", async () => {
    const { ctx, adapter } = await createKit(
      Array.from({ length: 64 }, () => text("Continue working.")),
    );
    const project = ctx.projects.create({ name: "Project", goal: "Bound Node turns" });
    const id = createWorkNode(ctx, project.id, "Collect").node.id;
    ctx.roadmaps.create({ definition: { projectId: project.id, nodes: [id], edges: [] }, reason: "Approved" });

    const result = await ctx.autoRun.start(project.id);
    expect(result).toMatchObject({
      status: "paused",
      reason: "node-turn-limit",
      nodeTurns: 64,
      mainTurns: 0,
    });
    expect(adapter.requests).toHaveLength(64);
    expect(ctx.autoRun.get(project.id)).toMatchObject(result);
  });

  it("resets the AutoRun budget when resuming after a budget pause", async () => {
    const { ctx, adapter } = await createKit([
      ...Array.from({ length: 64 }, () => text("Continue working.")),
      submit("submit-after-budget"),
      review("approve-after-budget", "complete"),
      text(),
    ]);
    const project = ctx.projects.create({ name: "Project", goal: "Resume after budget" });
    const id = createWorkNode(ctx, project.id, "Collect").node.id;
    ctx.roadmaps.create({ definition: { projectId: project.id, nodes: [id], edges: [] }, reason: "Approved" });

    const paused = await ctx.autoRun.start(project.id);
    expect(paused).toMatchObject({ status: "paused", reason: "node-turn-limit", nodeTurns: 64, mainTurns: 0 });

    const resumed = await ctx.autoRun.resume(project.id);
    expect(resumed).toMatchObject({ status: "completed", nodeTurns: 1, mainTurns: 1 });
    expect(resumed.runId).not.toBe(paused.runId);
    expect(adapter.requests).toHaveLength(67);
  });

  it("pauses on failed, blocked and interrupted Turns instead of retrying", async () => {
    const failedKit = await createKit([modelError("provider-failed")]);
    const failedProject = failedKit.ctx.projects.create({ name: "Project", goal: "Handle failure" });
    const failedNode = createWorkNode(failedKit.ctx, failedProject.id, "Fail").node.id;
    failedKit.ctx.roadmaps.create({ definition: { projectId: failedProject.id, nodes: [failedNode], edges: [] }, reason: "Approved" });
    await expect(failedKit.ctx.autoRun.start(failedProject.id)).resolves.toMatchObject({
      status: "paused",
      reason: "turn-failed",
      nodeTurns: 1,
    });
    expect(failedKit.adapter.requests).toHaveLength(1);

    const interruptedKit = await createKit([modelError("interrupted")]);
    const interruptedProject = interruptedKit.ctx.projects.create({ name: "Project", goal: "Handle interruption" });
    const interruptedNode = createWorkNode(interruptedKit.ctx, interruptedProject.id, "Interrupt").node.id;
    interruptedKit.ctx.roadmaps.create({
      definition: { projectId: interruptedProject.id, nodes: [interruptedNode], edges: [] },
      reason: "Approved",
    });
    await expect(interruptedKit.ctx.autoRun.start(interruptedProject.id)).resolves.toMatchObject({
      status: "paused",
      reason: "turn-interrupted",
      nodeTurns: 1,
    });
    expect(interruptedKit.adapter.requests).toHaveLength(1);
  });

  it("rejects invalid pause/resume controls and keeps a paused run single-owned", async () => {
    const { ctx, adapter } = await createKit([{ kind: "hang" }]);
    const project = ctx.projects.create({ name: "Project", goal: "Control lifecycle" });
    const id = createWorkNode(ctx, project.id, "Collect").node.id;
    ctx.roadmaps.create({ definition: { projectId: project.id, nodes: [id], edges: [] }, reason: "Approved" });

    expect(() => ctx.autoRun.pause(project.id)).toThrow(expect.objectContaining({ code: "auto-run-not-found" }));
    expect(() => ctx.autoRun.resume(project.id)).toThrow(expect.objectContaining({ code: "auto-run-not-found" }));

    const running = ctx.autoRun.start(project.id);
    await flushUntil(() => adapter.requests.length === 1);
    ctx.autoRun.pause(project.id);
    ctx.projectRuntime.stopNode(project.id, id);
    await running;

    expect(() => ctx.autoRun.resume(project.id)).not.toThrow();
  });

  it("requires a Goal and an existing Roadmap before starting", async () => {
    const { ctx } = await createKit([]);
    const project = ctx.projects.create({ name: "No plan", goal: null });
    expect(() => ctx.autoRun.start(project.id)).toThrow(expect.objectContaining({ code: "auto-run-unavailable" }));
    expect(ctx.autoRun.get(project.id)).toBeUndefined();
  });
});
