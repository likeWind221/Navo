import { describe, expect, it } from "vitest";
import { createProjectId } from "../../../src/brand/ids.js";
import { modelResponse } from "../../helpers/runtime.js";
import { addRoadmap, createKit, createWorkNode, flushUntil } from "./helpers.js";

const done = () => modelResponse([{ type: "text", text: "done" }]);

describe("ProjectRuntime Human lifecycle", () => {
  it("keeps Main dormant until Human start and reuses its Session across Turns", async () => {
    const { ctx, adapter } = await createKit([done(), done()]);
    const project = ctx.projects.create({ goal: "Main lifecycle" });
    await Promise.resolve();
    expect(adapter.requests).toHaveLength(0);
    expect(ctx.projectRuntime.canStartMain(project.id)).toBe(true);
    const first = await ctx.projectRuntime.startMain({ projectId: project.id, text: "First" });
    const second = await ctx.projectRuntime.startMain({ projectId: project.id, text: "Second" });
    expect(first).toMatchObject({ sessionId: project.mainSessionId, turn: { status: "completed" } });
    expect(second.sessionId).toBe(first.sessionId);
    expect(adapter.requests[1]?.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "user", content: [{ type: "text", text: "First" }] }),
    ]));
    expect(adapter.requests).toHaveLength(2);
    expect(ctx.projectRuntime.stopMain(project.id)).toBe(false);
  });

  it("rejects duplicate Main Turns through cancellation settlement and allows another Human Turn", async () => {
    const { ctx, adapter } = await createKit([{ kind: "hang" }, done()]);
    const project = ctx.projects.create({ goal: "No queue" });
    const input = { projectId: project.id, text: "Run" };
    const pending = ctx.projectRuntime.startMain(input);
    expect(() => ctx.projectRuntime.startMain(input)).toThrow(expect.objectContaining({ code: "turn-active" }));
    await flushUntil(() => adapter.requests.length === 1);
    expect(ctx.projectRuntime.stopMain(project.id)).toBe(true);
    expect(ctx.projectRuntime.stopMain(project.id)).toBe(false);
    expect(ctx.projectRuntime.canStartMain(project.id)).toBe(false);
    expect(() => ctx.projectRuntime.startMain(input)).toThrow();
    await expect(pending).resolves.toMatchObject({ turn: { status: "cancelled" } });
    await expect(ctx.projectRuntime.startMain(input)).resolves.toMatchObject({ turn: { status: "completed" } });
    expect(adapter.requests).toHaveLength(2);
  });

  it("distinguishes first Node start from continuation without implicit FIFO", async () => {
    const { ctx, adapter } = await createKit([done(), { kind: "hang" }, done()]);
    const project = ctx.projects.create({ goal: "Continue" });
    const node = createWorkNode(ctx, project.id, "Work");
    addRoadmap(ctx, project.id, [node.node.id]);
    const input = { projectId: project.id, nodeId: node.node.id, text: "First" };
    await expect(ctx.projectRuntime.continueNode(input)).rejects.toMatchObject({ code: "node-session-required" });
    expect(ctx.projectRuntime.canStartNode(project.id, node.node.id)).toBe(true);
    const first = await ctx.projectRuntime.startNode(input);
    expect(() => ctx.projectRuntime.startNode(input)).toThrow(expect.objectContaining({ code: "node-already-bound" }));
    const next = ctx.projectRuntime.continueNode({ ...input, text: "Continue" });
    expect(() => ctx.projectRuntime.continueNode(input)).toThrow(expect.objectContaining({ code: "invalid-state" }));
    await flushUntil(() => adapter.requests.length === 2);
    expect(ctx.projectRuntime.stopNode(project.id, node.node.id)).toBe(true);
    expect(ctx.projectRuntime.canContinueNode(project.id, node.node.id)).toBe(false);
    await expect(next).resolves.toMatchObject({ sessionId: first.sessionId, turn: { status: "cancelled" } });
    const last = await ctx.projectRuntime.continueNode(input);
    expect(last.sessionId).toBe(first.sessionId);
    expect(adapter.requests).toHaveLength(3);
    expect(ctx.nodes.get(node.node.id)?.status).toBe("idle");
  });

  it("cancels only the selected active Agent while Main and different Nodes run concurrently", async () => {
    const { ctx, adapter } = await createKit([{ kind: "hang" }, { kind: "hang" }, { kind: "hang" }]);
    const project = ctx.projects.create({ goal: "Independent cancellation" });
    const other = ctx.projects.create({ goal: "Other" });
    const a = createWorkNode(ctx, project.id, "A").node.id;
    const b = createWorkNode(ctx, project.id, "B").node.id;
    addRoadmap(ctx, project.id, [a, b]);
    const main = ctx.projectRuntime.startMain({ projectId: project.id, text: "Plan" });
    const first = ctx.projectRuntime.startNode({ projectId: project.id, nodeId: a, text: "A" });
    const second = ctx.projectRuntime.startNode({ projectId: project.id, nodeId: b, text: "B" });
    await flushUntil(() => adapter.requests.length === 3);
    expect(() => ctx.projectRuntime.stopNode(other.id, a)).toThrow(expect.objectContaining({ code: "node-not-found" }));
    expect(ctx.projectRuntime.stopNode(project.id, a)).toBe(true);
    await expect(first).resolves.toMatchObject({ turn: { status: "cancelled" } });
    expect(ctx.nodes.get(b)?.status).toBe("working");
    expect(ctx.projectRuntime.canStartMain(project.id)).toBe(false);
    ctx.projectRuntime.stopMain(project.id);
    await expect(main).resolves.toMatchObject({ turn: { status: "cancelled" } });
    expect(ctx.nodes.get(b)?.status).toBe("working");
    ctx.projectRuntime.stopNode(project.id, b);
    await expect(second).resolves.toMatchObject({ turn: { status: "cancelled" } });
    expect(adapter.requests).toHaveLength(3);
  });

  it("supports cancellation before Node dispatch and releases synchronous validation failures", async () => {
    const { ctx, adapter } = await createKit([]);
    const project = ctx.projects.create({ goal: "Early cancellation" });
    const nodeId = createWorkNode(ctx, project.id, "Work").node.id;
    addRoadmap(ctx, project.id, [nodeId]);
    const input = { projectId: project.id, nodeId, text: "" };
    await expect(ctx.projectRuntime.startNode(input)).rejects.toThrow();
    expect(ctx.projectRuntime.canStartNode(project.id, nodeId)).toBe(true);
    const pending = ctx.projectRuntime.startNode({ ...input, text: "Run" });
    const settled = expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(ctx.projectRuntime.stopNode(project.id, nodeId)).toBe(true);
    await settled;
    expect(ctx.nodes.get(nodeId)?.status).toBe("idle");
    expect(ctx.projectRuntime.canContinueNode(project.id, nodeId)).toBe(true);
    expect(adapter.requests).toHaveLength(0);
    await expect(ctx.projectRuntime.startMain({ projectId: project.id, text: " " })).rejects.toThrow();
    expect(ctx.projectRuntime.canStartMain(project.id)).toBe(true);
  });

  it("forwards caller cancellation and blocks new Main Turns on archived or missing Projects", async () => {
    const { ctx, adapter } = await createKit([{ kind: "hang" }]);
    const project = ctx.projects.create({ goal: "Caller cancellation" });
    const controller = new AbortController();
    const pending = ctx.projectRuntime.startMain({ projectId: project.id, text: "Run", signal: controller.signal });
    await flushUntil(() => adapter.requests.length === 1);
    controller.abort();
    await expect(pending).resolves.toMatchObject({ turn: { status: "cancelled" } });
    ctx.projects.archive(project.id, "Done");
    expect(ctx.projectRuntime.canStartMain(project.id)).toBe(false);
    expect(() => ctx.projectRuntime.startMain({ projectId: project.id, text: "Run" }))
      .toThrow(expect.objectContaining({ code: "project-unavailable" }));
    expect(() => ctx.projectRuntime.startMain({ projectId: createProjectId("missing"), text: "Run" }))
      .toThrow(expect.objectContaining({ code: "project-not-found" }));
  });
});
