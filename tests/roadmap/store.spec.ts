import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeId, createSessionId } from "../../src/brand/ids.js";
import { NodeStore } from "../../src/node/store.js";
import { ProjectStore } from "../../src/project/store.js";
import { RoadmapStore } from "../../src/roadmap/store.js";

const contexts: Context[] = [];
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())); });
const objective = { title: "Research", description: "Inspect sources", acceptanceCriteria: ["Sources reviewed"] };

async function kit() {
  const ctx = new Context(); contexts.push(ctx);
  await ctx.plugin(ProjectStore); await ctx.plugin(NodeStore); await ctx.plugin(RoadmapStore);
  const projectId = ctx.projects.create({ goal: "Research project" }).id;
  const a = ctx.nodes.create({ projectId, objective }).node.id;
  const b = ctx.nodes.create({ projectId, objective }).node.id;
  ctx.roadmaps.create({ definition: { projectId, nodes: [a, b], edges: [{ from: a, to: b }] }, reason: "Initial" });
  return { ctx, projectId, a, b };
}

describe("RoadmapStore", () => {
  it("returns nodes, statuses and dependency edges as a frontend map", async () => {
    const { ctx, projectId, a, b } = await kit();
    const map = ctx.roadmaps.map(projectId);
    expect(map.nodes.map(node => node.node.id)).toEqual([a, b]);
    expect(map.nodes.map(node => node.status)).toEqual(["idle", "locked"]);
    expect(map.edges).toEqual([{ from: a, to: b }]);
  });

  it("auto unlocks downstream nodes after completion or skip", async () => {
    const { ctx, projectId, a, b } = await kit();
    const ready = ctx.nodes.get(a)!;
    const done = ctx.nodes.confirmCompletion(a, { confirmedBy: "human", reason: "Accepted", reviewedRevision: ready.revision });
    expect(done.status).toBe("completing");
    expect(ctx.nodes.get(b)?.status).toBe("idle");
    const c = createNodeId("c");
    const next = ctx.roadmaps.change({ projectId, baseRevision: 1, reason: "Phase two", newNodes: [{ nodeId: c, input: { projectId, objective } }], changes: [
      { type: "insert", nodeId: c }, { type: "connect", edge: { from: b, to: c } },
    ] });
    expect(next.graph.definition.nodes).toEqual([a, b, c]);
    expect(ctx.nodes.get(c)?.status).toBe("locked");
    const skipped = ctx.nodes.skip(b, { confirmedBy: "human", reason: "Optional", reviewedRevision: ctx.nodes.get(b)!.revision });
    expect(skipped.status).toBe("skipped");
    expect(ctx.nodes.get(c)?.status).toBe("idle");
  });

  it("rejects manual unlock before required ancestors finish", async () => {
    const { ctx, a, b } = await kit();
    expect(() => ctx.nodes.unlock(b, "Force")).toThrow(expect.objectContaining({ code: "invalid-reference" }));
    const ready = ctx.nodes.get(a)!;
    ctx.nodes.confirmCompletion(a, { confirmedBy: "human", reason: "Done", reviewedRevision: ready.revision });
    expect(ctx.nodes.get(b)?.status).toBe("idle");
  });

  it("supports repeated work cycles and human skip", async () => {
    const { ctx, a } = await kit();
    ctx.nodes.bindSession(a, createSessionId("work"));
    ctx.nodes.beginWork(a); ctx.nodes.endWork(a);
    ctx.nodes.beginWork(a); const idle = ctx.nodes.endWork(a);
    expect(idle.status).toBe("idle");
    expect(ctx.nodes.skip(a, { confirmedBy: "human", reason: "No longer needed", reviewedRevision: idle.revision }).status).toBe("skipped");
  });

  it("re-locks an idle node when a new required predecessor is connected", async () => {
    const { ctx, projectId, a, b } = await kit();
    const ready = ctx.nodes.get(a)!;
    ctx.nodes.confirmCompletion(a, { confirmedBy: "human", reason: "Done", reviewedRevision: ready.revision });
    expect(ctx.nodes.get(b)?.status).toBe("idle");
    const c = createNodeId("predecessor");
    ctx.roadmaps.change({ projectId, baseRevision: 1, reason: "Add prerequisite", newNodes: [{ nodeId: c, input: { projectId, objective } }], changes: [
      { type: "insert", nodeId: c }, { type: "connect", edge: { from: c, to: b } },
    ] });
    expect(ctx.nodes.get(b)?.status).toBe("locked");
    expect(ctx.nodes.get(c)?.status).toBe("idle");
  });
});
