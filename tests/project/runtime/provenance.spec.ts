import { describe, expect, it } from "vitest";

import { createToolCallId } from "../../../src/brand/ids.js";
import type { GenerateRequest } from "../../../src/llm/types.js";
import { modelResponse } from "../../helpers/runtime.js";
import { createKit, createWorkNode } from "./helpers.js";

function call(name: string, arguments_: unknown) {
  return modelResponse([{
    type: "tool-call", id: createToolCallId(name), name, arguments: JSON.stringify(arguments_),
  }], "tool-calls");
}

function checklist(request: GenerateRequest) {
  const text = request.messages.at(-1)!.content
    .flatMap(block => block.type === "text" ? [block.text] : []).join("\n");
  return JSON.parse(text.slice(text.indexOf("\n{") + 1, text.lastIndexOf("\n</system-reminder>")));
}

describe("Review submission provenance", () => {
  it.each([true, false])("exposes persisted checks with satisfied=%s despite truncated arguments", async satisfied => {
    const summary = JSON.stringify({ result: "x".repeat(727) });
    const { ctx, adapter } = await createKit([
      call("submit_completion", {
        summary, resource_ids: [],
        criteria: [{ criterion_index: 1, satisfied, note: "Unverified result claim" }],
        remaining: satisfied ? [] : ["Check the result"],
      }),
      call("read_node_turn", {}),
      call("submit_review", { decision: "escalate", reason: "Result still needs independent evidence" }),
      modelResponse([{ type: "text", text: "Needs evidence." }]),
    ]);
    const project = ctx.projects.create({ name: "Review", goal: "Check evidence" });
    const nodeId = createWorkNode(ctx, project.id, "Collect").node.id;
    ctx.roadmaps.create({ definition: { projectId: project.id, nodes: [nodeId], edges: [] }, reason: "Review" });
    await ctx.projectRuntime.startNode({ projectId: project.id, nodeId, text: "Work" });
    const submission = ctx.nodes.get(nodeId)!.submission!;
    await ctx.projectRuntime.startReview({ projectId: project.id, nodeId, text: "Review" });

    const data = checklist(adapter.requests[1]!);
    expect(data.criteria).toEqual([{ index: 1, criterion: "Collect complete" }]);
    expect(data.completionSignal).toEqual({
      source: "validated-node-submission", summary, resourceIds: [],
      criteria: [{ index: 1, satisfied, note: "Unverified result claim" }],
      remaining: satisfied ? [] : ["Check the result"], submittedAt: submission.submittedAt,
    });
    const rules = JSON.stringify(adapter.requests[1]!.messages);
    expect(rules).toContain("structure only, not task correctness");
    expect(rules).toContain("Do not request resubmission merely because a truncated work log omits those fields");
    const log = JSON.stringify(adapter.requests[2]!.messages.at(-1));
    expect(log).toContain("truncated");
    expect(log).not.toContain("criterion_index");
    expect(ctx.nodes.get(nodeId)).toMatchObject({ status: "submitted", lastReview: { decision: "escalate" } });
    expect(ctx.nodes.get(nodeId)!.submission).toEqual(submission);
  });

  it.each([
    { label: "missing", criteria: [] },
    { label: "duplicate", criteria: [
      { criterion_index: 1, satisfied: true, note: "One" },
      { criterion_index: 1, satisfied: true, note: "Again" },
    ] },
  ])("does not expose a validated submission for $label criteria", async ({ criteria }) => {
    const { ctx, adapter } = await createKit([
      call("submit_completion", { summary: "Claimed result", resource_ids: [], criteria, remaining: [] }),
      modelResponse([{ type: "text", text: "Submission rejected." }]),
      modelResponse([{ type: "text", text: "Cannot verify." }]),
    ]);
    const project = ctx.projects.create({ name: "Invalid", goal: "Reject invalid submissions" });
    const nodeId = createWorkNode(ctx, project.id, "Collect").node.id;
    ctx.roadmaps.create({ definition: { projectId: project.id, nodes: [nodeId], edges: [] }, reason: "Review" });
    await ctx.projectRuntime.startNode({ projectId: project.id, nodeId, text: "Work" });
    expect(ctx.nodes.get(nodeId)!.submission).toBeUndefined();
    await ctx.projectRuntime.startReview({ projectId: project.id, nodeId, text: "Review" });
    expect(checklist(adapter.requests[2]!).completionSignal).toBeNull();
    expect(ctx.nodes.get(nodeId)!.status).toBe("idle");
  });
});
