import { describe, expect, it } from "vitest";
import { createKit, createWorkNode, flushUntil } from "./helpers.js";

describe("ProjectRuntime Human review", () => {
  it("preserves revision and control-node rules and only unlocks downstream work", async () => {
    const { ctx, adapter } = await createKit([]);
    const project = ctx.projects.create({ goal: "Review" });
    const control = ctx.nodes.create({ projectId: project.id, kind: "control", purpose: "checkpoint", title: "Review" });
    const next = createWorkNode(ctx, project.id, "Next");
    ctx.roadmaps.create({
      definition: { projectId: project.id, nodes: [control.node.id, next.node.id], edges: [{ from: control.node.id, to: next.node.id }] },
      reason: "Review before work",
    });
    const nodeId = control.node.id;
    const confirmation = { confirmedBy: "human", reason: "Accepted", reviewedRevision: ctx.nodes.get(nodeId)!.revision };
    expect(() => ctx.projectRuntime.confirmCompletion(project.id, nodeId, { ...confirmation, reviewedRevision: 0 }))
      .toThrow(expect.objectContaining({ code: "stale-revision" }));
    const completed = ctx.projectRuntime.confirmCompletion(project.id, nodeId, confirmation);
    expect(completed.status).toBe("completing");
    expect(completed.sessionId).toBeUndefined();
    expect(ctx.nodes.get(next.node.id)?.status).toBe("idle");
    await Promise.resolve();
    expect(adapter.requests).toHaveLength(0);
    expect(() => ctx.projectRuntime.skipNode(project.id, nodeId, { ...confirmation, reviewedRevision: completed.revision })).toThrow();
  });

  it("checks Project ownership and allows skip of locked Nodes with current revision", async () => {
    const { ctx } = await createKit([]);
    const project = ctx.projects.create({ goal: "Review" });
    const other = ctx.projects.create({ goal: "Other" });
    const node = createWorkNode(ctx, project.id, "Locked");
    const confirmation = { confirmedBy: "human", reason: "Skip", reviewedRevision: node.revision };
    expect(() => ctx.projectRuntime.confirmCompletion(project.id, node.node.id, confirmation)).toThrow();
    for (const method of ["confirmCompletion", "skipNode"] as const) {
      expect(() => ctx.projectRuntime[method](other.id, node.node.id, confirmation))
        .toThrow(expect.objectContaining({ code: "node-not-found" }));
    }
    expect(() => ctx.projectRuntime.skipNode(project.id, node.node.id, { ...confirmation, reviewedRevision: 0 }))
      .toThrow(expect.objectContaining({ code: "stale-revision" }));
    expect(ctx.projectRuntime.skipNode(project.id, node.node.id, confirmation).status).toBe("skipped");
    const archived = createWorkNode(ctx, project.id, "Archived");
    ctx.projects.archive(project.id, "Pause");
    expect(() => ctx.projectRuntime.skipNode(project.id, archived.node.id, { ...confirmation, reviewedRevision: archived.revision }))
      .toThrow(expect.objectContaining({ code: "project-unavailable" }));
  });

  it("rejects review during the pre-working reservation and active Turn", async () => {
    const { ctx, adapter } = await createKit([{ kind: "hang" }]);
    const project = ctx.projects.create({ goal: "No review race" });
    const nodeId = createWorkNode(ctx, project.id, "Work").node.id;
    ctx.nodes.unlock(nodeId, "Ready");
    const pending = ctx.projectRuntime.startNode({ projectId: project.id, nodeId, text: "Run" });
    expect(ctx.nodes.get(nodeId)?.status).toBe("idle");
    const review = () => {
      const confirmation = { confirmedBy: "human", reason: "Review", reviewedRevision: ctx.nodes.get(nodeId)!.revision };
      for (const method of ["confirmCompletion", "skipNode"] as const) {
        expect(() => ctx.projectRuntime[method](project.id, nodeId, confirmation))
          .toThrow(expect.objectContaining({ code: "invalid-state" }));
      }
    };
    review();
    await flushUntil(() => adapter.requests.length === 1);
    review();
    ctx.projectRuntime.stopNode(project.id, nodeId);
    await pending;
    expect(ctx.projectRuntime.confirmCompletion(project.id, nodeId, {
      confirmedBy: "human", reason: "Accepted", reviewedRevision: ctx.nodes.get(nodeId)!.revision,
    }).status).toBe("completing");
  });
});
