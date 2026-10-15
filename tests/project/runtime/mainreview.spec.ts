import { describe, expect, it } from "vitest";

import { createSessionId, createToolCallId } from "../../../src/brand/ids.js";
import type { ToolCallContentBlock } from "../../../src/llm/types.js";
import { SUBMIT_COMPLETION_TOOL_NAME } from "../../../src/tools/builtins/node/submit.js";
import { SUBMIT_REVIEW_TOOL_NAME } from "../../../src/tools/builtins/project/review.js";
import { createSubmitReviewTool } from "../../../src/tools/builtins/project/review.js";
import { createReadNodeTurnTool, READ_NODE_TURN_TOOL_NAME } from "../../../src/tools/builtins/project/turnlog.js";
import { ToolExecutionError } from "../../../src/tools/errors.js";
import { modelResponse } from "../../helpers/runtime.js";
import { createKit, createWorkNode, flushUntil } from "./helpers.js";

function call(id: string, name: string, arguments_: unknown): ToolCallContentBlock {
  return { type: "tool-call", id: createToolCallId(id), name, arguments: JSON.stringify(arguments_) };
}

function nodeSubmits() {
  return modelResponse([call("node-submit", SUBMIT_COMPLETION_TOOL_NAME, {
    summary: "Collected the sources",
    resource_ids: [],
    criteria: [{ criterion_index: 1, satisfied: true, note: "All sources listed" }],
    remaining: [],
  })], "tool-calls");
}

function decision(id: string, arguments_: Record<string, unknown>) {
  return modelResponse([call(id, SUBMIT_REVIEW_TOOL_NAME, arguments_)], "tool-calls");
}

const done = () => modelResponse([{ type: "text", text: "Reviewed." }]);

async function chain(entries: Parameters<typeof createKit>[0]) {
  const kit = await createKit(entries);
  const project = kit.ctx.projects.create({ name: "Project", goal: "Review work" });
  const first = createWorkNode(kit.ctx, project.id, "Collect").node.id;
  const next = createWorkNode(kit.ctx, project.id, "Write").node.id;
  kit.ctx.roadmaps.create({
    definition: { projectId: project.id, nodes: [first, next], edges: [{ from: first, to: next }] },
    reason: "Collect before writing",
  });
  const review = (text = "Please review") => kit.ctx.projectRuntime.startReview({ projectId: project.id, nodeId: first, text });
  const run = () => kit.ctx.projectRuntime.startNode({ projectId: project.id, nodeId: first, text: "Collect sources" });
  return { ...kit, project, first, next, review, run };
}

describe("Main review of a Node", () => {
  it("lets Main check evidence, complete the Node as Main and unlock downstream work", async () => {
    const { ctx, adapter, project, first, next, review, run } = await chain([
      nodeSubmits(),
      modelResponse([call("log", READ_NODE_TURN_TOOL_NAME, {})], "tool-calls"),
      decision("decide", { decision: "complete", reason: "Read the work log: sources were submitted" }),
      done(),
    ]);
    await run();
    expect(ctx.nodes.get(first)?.status).toBe("submitted");
    expect(ctx.reviews.isPending(ctx.nodes.get(first)!)).toBe(true);

    const result = await review();
    expect(result.turn).toMatchObject({ status: "completed", steps: 3 });
    const completed = ctx.nodes.get(first)!;
    expect(completed).toMatchObject({
      status: "completing",
      confirmation: { confirmedBy: "main", reason: "Read the work log: sources were submitted" },
      lastReview: { decision: "complete" },
    });
    expect(ctx.reviews.isPending(completed)).toBe(false);
    expect(ctx.nodes.get(next)?.status).toBe("idle");

    const reviewRequest = adapter.requests[1]!;
    expect(reviewRequest.tools?.map(tool => tool.name)).toEqual(expect.arrayContaining([
      SUBMIT_REVIEW_TOOL_NAME, READ_NODE_TURN_TOOL_NAME, "modify_roadmap", "fetch_resource",
    ]));
    const prompt = JSON.stringify(reviewRequest.messages);
    expect(prompt).toContain("review checklist");
    expect(prompt).toContain("not a verified fact");
    expect(prompt).toContain("claims-satisfied");
    expect(JSON.stringify(adapter.requests[2]?.messages)).toContain("submit_completion(");
    expect(ctx.reviews.get(project.id)).toBeUndefined();
  });

  it("returns a Node for rework with Main feedback that the Node sees next Turn", async () => {
    const { ctx, adapter, project, first, next, review, run } = await chain([
      nodeSubmits(),
      decision("decide", { decision: "rework", reason: "Opened nothing; claims unsupported", feedback: "Cite the primary source" }),
      done(),
      modelResponse([{ type: "text", text: "Added the citation." }]),
    ]);
    await run();
    await review();
    const reworked = ctx.nodes.get(first)!;
    expect(reworked).toMatchObject({
      status: "idle",
      reworkCount: 1,
      pendingFeedback: { requestedBy: "main", feedback: "Cite the primary source" },
      lastReview: { decision: "rework" },
    });
    expect(reworked.submission).toBeUndefined();
    expect(ctx.nodes.get(next)?.status).toBe("locked");

    await ctx.projectRuntime.continueNode({ projectId: project.id, nodeId: first, text: "Continue" });
    expect(JSON.stringify(adapter.requests.at(-1)?.messages.at(-1))).toContain("Cite the primary source");
    expect(ctx.reviews.isPending(ctx.nodes.get(first)!)).toBe(true);
  });

  it("accepts exactly one decision per review", async () => {
    const { ctx, adapter, first, review, run } = await chain([
      nodeSubmits(),
      decision("one", { decision: "complete", reason: "Verified" }),
      decision("two", { decision: "skip", reason: "Changed my mind" }),
      done(),
    ]);
    await run();
    await review();
    expect(ctx.nodes.get(first)).toMatchObject({ status: "completing", lastReview: { decision: "complete" } });
    expect(JSON.stringify(adapter.requests[3]?.messages)).toContain("already has a decision");
  });

  it("leaves the Node unchanged and pending when Main gives no decision", async () => {
    const { ctx, first, review, run } = await chain([
      nodeSubmits(),
      modelResponse([{ type: "text", text: "Looks fine to me." }]),
    ]);
    await run();
    const before = ctx.nodes.get(first)!;
    await review();
    expect(ctx.nodes.get(first)).toEqual(before);
    expect(ctx.reviews.isPending(before)).toBe(true);
    expect(ctx.reviews.get(before.node.projectId)).toBeUndefined();
  });

  it("refuses Main rework after two returns and Main completion of a Node that never ran", async () => {
    const { ctx, adapter, project, first, review } = await chain([
      decision("never-ran", { decision: "complete", reason: "Assume it is done" }),
      decision("escalate-never", { decision: "escalate", reason: "Nothing has run yet" }),
      done(),
      decision("third-rework", { decision: "rework", reason: "Still wrong", feedback: "Fix it" }),
      decision("escalate", { decision: "escalate", reason: "Needs the Human" }),
      done(),
    ]);
    await review();
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain("never ran");
    expect(ctx.nodes.get(first)).toMatchObject({ status: "idle", lastReview: { decision: "escalate" } });
    expect(ctx.nodes.get(first)?.lastReview?.turnId).toBeUndefined();
    expect(JSON.stringify(adapter.requests[0]?.messages)).toMatch(/neverExecuted[\\"]+: true/);

    ctx.nodes.bindSession(first, createSessionId("session-never-ran"));
    for (let round = 0; round < 2; round += 1) {
      ctx.nodes.beginWork(first);
      ctx.nodes.signalCompletion(first, {
        summary: "Done", resourceIds: [],
        criteria: [{ criterion: "Collect complete", satisfied: true, note: "ok" }], remaining: [],
      });
      const submitted = ctx.nodes.endWork(first);
      ctx.projectRuntime.requestRework(project.id, first,
        { requestedBy: "human", feedback: `Round ${round}`, reviewedRevision: submitted.revision });
    }
    expect(ctx.nodes.get(first)?.reworkCount).toBe(2);
    await review();
    expect(JSON.stringify(adapter.requests[4]?.messages)).toContain("already returned 2 times");
    expect(ctx.nodes.get(first)).toMatchObject({ reworkCount: 2, lastReview: { decision: "escalate" } });
  });

  it("invalidates a decision when the reviewed Node changed during review", async () => {
    const { ctx, project, first, run } = await chain([nodeSubmits()]);
    await run();
    ctx.reviews.begin(project.id, first);
    const current = ctx.nodes.get(first)!;
    ctx.nodes.setRequirement(first, "optional", current.revision, "Changed during review");
    expect(() => ctx.reviews.submit(project.id, { decision: "complete", reason: "Verified" }))
      .toThrow(expect.objectContaining({ code: "stale-revision" }));
    expect(ctx.nodes.get(first)?.status).toBe("submitted");
    ctx.reviews.end(project.id);
  });

  it("locks the reviewed Node and Main while the review Turn runs", async () => {
    const { ctx, adapter, project, first, next, review, run } = await chain([nodeSubmits(), { kind: "hang" }]);
    await run();
    const pending = review();
    await flushUntil(() => adapter.requests.length === 2);
    expect(ctx.projectRuntime.nodeActions(project.id, first))
      .toEqual({ run: false, complete: false, skip: false, rework: false, review: false });
    expect(() => ctx.projectRuntime.confirmCompletion(project.id, first,
      { confirmedBy: "human", reason: "Now", reviewedRevision: ctx.nodes.get(first)!.revision }))
      .toThrow(expect.objectContaining({ code: "invalid-state" }));
    expect(() => ctx.projectRuntime.continueNode({ projectId: project.id, nodeId: first, text: "Go" })).toThrow();
    expect(() => review()).toThrow(expect.objectContaining({ code: "turn-active" }));
    expect(ctx.projectRuntime.nodeActions(project.id, next).review).toBe(false);
    expect(ctx.projectRuntime.stopMain(project.id)).toBe(true);
    await expect(pending).resolves.toMatchObject({ turn: { status: "cancelled" } });
    expect(ctx.projectRuntime.nodeActions(project.id, first))
      .toEqual({ run: false, complete: true, skip: true, rework: true, review: true });
  });

  it("truncates long Node replies in the checklist and refuses review of a locked Node", async () => {
    const { ctx, adapter, project, first, next, review, run } = await chain([
      modelResponse([{ type: "text", text: "x".repeat(5_000) }]),
      done(),
    ]);
    await run();
    await review();
    const checklist = JSON.stringify(adapter.requests[1]?.messages);
    expect(checklist).toContain("truncated 3500 chars");
    expect(checklist).not.toContain("x".repeat(1_600));
    expect(() => ctx.projectRuntime.startReview({ projectId: project.id, nodeId: next, text: "Review" }))
      .toThrow(expect.objectContaining({ code: "invalid-state" }));
  });

  it("serves a paged work log only to Main during a review and refuses Node callers", async () => {
    const { ctx, project, first, run } = await chain([nodeSubmits()]);
    await run();
    const log = createReadNodeTurnTool(ctx);
    const submit = createSubmitReviewTool(ctx);
    const node = ctx.nodes.get(first)!;
    const nodeSession = node.sessionId!;
    const execution = (sessionId: typeof nodeSession) => ({ callId: createToolCallId("c"), signal: new AbortController().signal, sessionId });
    expect(() => log.execute({}, execution(project.mainSessionId))).toThrow(ToolExecutionError);
    ctx.reviews.begin(project.id, first);
    const page = await log.execute({}, execution(project.mainSessionId));
    expect(page.content).toContain("page 1 of 1");
    expect(page.content).toContain("submit_completion(");
    expect(() => log.execute({ page: 2 }, execution(project.mainSessionId))).toThrow(ToolExecutionError);
    expect(() => log.execute({}, execution(nodeSession))).toThrow(ToolExecutionError);
    expect(() => submit.execute({ decision: "complete", reason: "x" }, execution(nodeSession))).toThrow(ToolExecutionError);
    expect(() => submit.execute({ decision: "approve", reason: "x" }, execution(project.mainSessionId))).toThrow(ToolExecutionError);
    ctx.reviews.end(project.id);
  });
});
