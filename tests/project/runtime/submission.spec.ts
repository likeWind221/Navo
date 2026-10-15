import { describe, expect, it } from "vitest";

import { createToolCallId } from "../../../src/brand/ids.js";
import type { ToolCallContentBlock } from "../../../src/llm/types.js";
import { SEND_TO_MAIN_TOOL_NAME } from "../../../src/tools/builtins/mailbox/send.js";
import { createSubmitCompletionTool, SUBMIT_COMPLETION_TOOL_NAME } from "../../../src/tools/builtins/node/submit.js";
import { ToolExecutionError } from "../../../src/tools/errors.js";
import { modelResponse } from "../../helpers/runtime.js";
import { createKit, createWorkNode } from "./helpers.js";

function call(id: string, name: string, arguments_: unknown): ToolCallContentBlock {
  return { type: "tool-call", id: createToolCallId(id), name, arguments: JSON.stringify(arguments_) };
}

function submit(id: string, overrides: Record<string, unknown> = {}): ToolCallContentBlock {
  return call(id, SUBMIT_COMPLETION_TOOL_NAME, {
    summary: "Collected the sources",
    resource_ids: [],
    criteria: [{ criterion_index: 1, satisfied: true, note: "All sources listed" }],
    remaining: [],
    ...overrides,
  });
}

async function chain(entries: Parameters<typeof createKit>[0]) {
  const kit = await createKit(entries);
  const project = kit.ctx.projects.create({ name: "Project", goal: "Submit work" });
  const first = createWorkNode(kit.ctx, project.id, "Collect").node.id;
  const next = createWorkNode(kit.ctx, project.id, "Write").node.id;
  kit.ctx.roadmaps.create({
    definition: { projectId: project.id, nodes: [first, next], edges: [{ from: first, to: next }] },
    reason: "Collect before writing",
  });
  return { ...kit, project, first, next };
}

describe("Node completion signal and Human review", () => {
  it("ends the Turn on submission, waits for review, and delivers rework feedback to the next Turn", async () => {
    const { ctx, adapter, project, first, next } = await chain([
      modelResponse([submit("submit-1"), call("late", SEND_TO_MAIN_TOOL_NAME, { message: "after submit" })], "tool-calls"),
      modelResponse([submit("submit-2", { summary: "Added the 2024 data" })], "tool-calls"),
    ]);

    const result = await ctx.projectRuntime.startNode({ projectId: project.id, nodeId: first, text: "Collect sources" });
    expect(result.turn).toMatchObject({ status: "completed", steps: 1 });
    expect(adapter.requests).toHaveLength(1);
    expect(ctx.mailbox.getHistory(project.id)).toHaveLength(0);
    const submitted = ctx.nodes.get(first)!;
    expect(submitted).toMatchObject({
      status: "submitted",
      submission: {
        summary: "Collected the sources",
        criteria: [{ criterion: "Collect complete", satisfied: true, note: "All sources listed" }],
        remaining: [],
      },
    });
    expect(ctx.nodes.get(next)?.status).toBe("locked");
    expect(ctx.projectRuntime.nodeActions(project.id, first)).toEqual({ run: false, complete: true, skip: true, rework: true, review: true });
    expect(() => ctx.projectRuntime.continueNode({ projectId: project.id, nodeId: first, text: "More" }))
      .toThrow(expect.objectContaining({ code: "invalid-state" }));

    const rework = { requestedBy: "human", feedback: "Add the 2024 data", reviewedRevision: submitted.revision };
    expect(() => ctx.projectRuntime.requestRework(project.id, first, { ...rework, reviewedRevision: submitted.revision - 1 }))
      .toThrow(expect.objectContaining({ code: "stale-revision" }));
    const reworked = ctx.projectRuntime.requestRework(project.id, first, rework);
    expect(reworked.status).toBe("idle");
    expect(reworked.submission).toBeUndefined();
    expect(reworked.pendingFeedback).toMatchObject({ requestedBy: "human", feedback: "Add the 2024 data" });
    if (reworked.node.kind !== "work") throw new Error("Expected a work node");
    expect(reworked.node.objective.acceptanceCriteria).toEqual(["Collect complete"]);
    expect(ctx.nodes.get(next)?.status).toBe("locked");
    await Promise.resolve();
    expect(adapter.requests).toHaveLength(1);

    await ctx.projectRuntime.continueNode({ projectId: project.id, nodeId: first, text: "Continue" });
    const userMessage = JSON.stringify(adapter.requests[1]?.messages.at(-1));
    expect(userMessage).toContain("returned for rework");
    expect(userMessage).toContain("Add the 2024 data");
    const resubmitted = ctx.nodes.get(first)!;
    expect(resubmitted).toMatchObject({ status: "submitted", submission: { summary: "Added the 2024 data" } });
    expect(resubmitted.pendingFeedback).toBeUndefined();

    const completed = ctx.projectRuntime.confirmCompletion(project.id, first,
      { confirmedBy: "human", reason: "Looks right", reviewedRevision: resubmitted.revision });
    expect(completed.status).toBe("completing");
    expect(ctx.nodes.get(next)?.status).toBe("idle");
  });

  it("rejects incomplete or out-of-scope submissions and keeps the Node runnable", async () => {
    const { ctx, adapter, project, first } = await chain([
      modelResponse([submit("missing", { criteria: [] })], "tool-calls"),
      modelResponse([submit("invisible", { resource_ids: ["resource-elsewhere"] })], "tool-calls"),
      modelResponse([submit("duplicate", { criteria: [
        { criterion_index: 1, satisfied: true, note: "a" }, { criterion_index: 1, satisfied: false, note: "b" },
      ] })], "tool-calls"),
      modelResponse([{ type: "text", text: "I still need the sources." }]),
    ]);
    const result = await ctx.projectRuntime.startNode({ projectId: project.id, nodeId: first, text: "Collect" });
    expect(result.turn).toMatchObject({ status: "completed", steps: 4 });
    const transcript = JSON.stringify(adapter.requests.slice(1).map(request => request.messages.at(-1)));
    expect(transcript).toContain("criteria must cover all 1 acceptance criteria.");
    expect(transcript).toContain("Resource 'resource-elsewhere' is not visible to this Node.");
    expect(transcript).toContain("criterion_index 1 is listed more than once.");
    expect(ctx.nodes.get(first)).toMatchObject({ status: "idle" });
    expect(ctx.nodes.get(first)?.submission).toBeUndefined();
    expect(ctx.projectRuntime.nodeActions(project.id, first).rework).toBe(false);
  });

  it("lets Human skip a submitted Node and refuses submission from Main or outside a Turn", async () => {
    const { ctx, project, first, next } = await chain([modelResponse([submit("submit")], "tool-calls")]);
    const tool = createSubmitCompletionTool(ctx);
    const execution = { callId: createToolCallId("main"), signal: new AbortController().signal };
    expect(() => tool.execute({}, { ...execution, sessionId: project.mainSessionId })).toThrow(ToolExecutionError);

    await ctx.projectRuntime.startNode({ projectId: project.id, nodeId: first, text: "Collect" });
    const submitted = ctx.nodes.get(first)!;
    expect(() => tool.execute({}, { ...execution, sessionId: submitted.sessionId! })).toThrow(ToolExecutionError);
    const skipped = ctx.projectRuntime.skipNode(project.id, first,
      { confirmedBy: "human", reason: "Out of scope", reviewedRevision: submitted.revision });
    expect(skipped).toMatchObject({ status: "skipped", submission: { summary: "Collected the sources" } });
    expect(ctx.nodes.get(next)?.status).toBe("idle");
  });
});
