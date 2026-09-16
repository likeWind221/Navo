import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";
import { createNodeId, createProjectId, createSessionId } from "../../src/brand/ids.js";
import { ProjectStore } from "../../src/project/store.js";
import { NodeStore } from "../../src/node/store.js";
import { projectNode } from "../../src/node/projector.js";
import type { NodeEvent } from "../../src/node/events.js";

const contexts: Context[] = [];
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())); });

async function kit() {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(ProjectStore);
  await ctx.plugin(NodeStore);
  const project = ctx.projects.create({ goal: "Research" });
  const objective = { title: "Sources", description: "Inspect sources", acceptanceCriteria: ["Cite primary sources"] };
  return { ctx, project, objective };
}

describe("generic Project Nodes", () => {
  it("creates immutable locked Nodes with independent project ownership", async () => {
    const { ctx, project, objective } = await kit();
    const node = ctx.nodes.create({ projectId: project.id, objective });
    if (node.node.kind !== "work") throw new Error("Expected a work node");
    objective.acceptanceCriteria.push("Changed");
    expect(node.status).toBe("locked");
    expect(node.node.objective.acceptanceCriteria).toEqual(["Cite primary sources"]);
    expect(Object.isFrozen(node.node.objective.acceptanceCriteria)).toBe(true);
    expect(ctx.nodes.getByProject(project.id)).toEqual([node]);
    expect(ctx.nodes.getByProject(createProjectId("other"))).toEqual([]);
    expect(() => ctx.nodes.create({ projectId: createProjectId("missing"), objective }))
      .toThrow(expect.objectContaining({ code: "project-unavailable" }));
    expect(() => ctx.nodes.create({ projectId: project.id, objective: { ...objective, title: " " } }))
      .toThrow(expect.objectContaining({ code: "invalid-event-stream" }));
    expect(ctx.nodes.getByProject(project.id)).toHaveLength(1);
  });

  it("preserves unique Node sessions and rejects Main sessions", async () => {
    const { ctx, project, objective } = await kit();
    const a = ctx.nodes.create({ projectId: project.id, objective }).node.id;
    const b = ctx.nodes.create({ projectId: project.id, objective }).node.id;
    const session = createSessionId("session");
    ctx.nodes.unlock(a, "Ready");
    ctx.nodes.unlock(b, "Ready");
    expect(() => ctx.nodes.bindSession(a, project.mainSessionId))
      .toThrow(expect.objectContaining({ code: "session-already-bound" }));
    ctx.nodes.bindSession(a, session);
    expect(ctx.nodes.getBySession(session)?.node.id).toBe(a);
    expect(() => ctx.nodes.bindSession(b, session)).toThrow(expect.objectContaining({ code: "session-already-bound" }));
    expect(() => ctx.nodes.bindSession(a, createSessionId("another")))
      .toThrow(expect.objectContaining({ code: "node-already-bound" }));
  });

  it("requires explicit versioned human confirmation for the terminal state", async () => {
    const { ctx, project, objective } = await kit();
    const id = ctx.nodes.create({ projectId: project.id, objective }).node.id;
    expect(() => ctx.nodes.beginWork(id)).toThrow(expect.objectContaining({ code: "invalid-state" }));
    ctx.nodes.unlock(id, "Ready");
    ctx.nodes.bindSession(id, createSessionId("main-work"));
    const idle = ctx.nodes.get(id)!;
    ctx.nodes.beginWork(id);
    expect(() => ctx.nodes.confirmCompletion(id, { confirmedBy: "reviewer", reason: "OK", reviewedRevision: idle.revision }))
      .toThrow(expect.objectContaining({ code: "invalid-state" }));
    expect(() => ctx.nodes.lock(id, "Lock")).toThrow(expect.objectContaining({ code: "invalid-state" }));
    const ended = ctx.nodes.endWork(id);
    expect(ended.status).toBe("idle");
    expect(() => ctx.nodes.confirmCompletion(id, { confirmedBy: "reviewer", reason: "OK", reviewedRevision: idle.revision }))
      .toThrow(expect.objectContaining({ code: "stale-revision" }));
    const complete = ctx.nodes.confirmCompletion(id, {
      confirmedBy: "reviewer", reason: "Sources inspected", reviewedRevision: ended.revision,
    });
    expect(complete).toMatchObject({ status: "completing", confirmation: { confirmedBy: "reviewer" } });
    expect(() => ctx.nodes.beginWork(id)).toThrow(expect.objectContaining({ code: "invalid-state" }));
    expect(() => ctx.nodes.unlock(id, "Again")).toThrow(expect.objectContaining({ code: "invalid-state" }));
    expect(projectNode(id, JSON.parse(JSON.stringify(ctx.nodes.getEvents(id))))).toEqual(complete);
  });

  it("supports relocking and allows work cleanup after project archival", async () => {
    const { ctx, project, objective } = await kit();
    const id = ctx.nodes.create({ projectId: project.id, objective }).node.id;
    ctx.nodes.unlock(id, "Ready");
    ctx.nodes.lock(id, "Dependency unavailable");
    expect(ctx.nodes.get(id)?.status).toBe("locked");
    ctx.nodes.unlock(id, "Available");
    ctx.nodes.bindSession(id, createSessionId("work"));
    ctx.nodes.beginWork(id);
    ctx.projects.archive(project.id, "Pause project");
    expect(ctx.nodes.endWork(id).status).toBe("idle");
    expect(() => ctx.nodes.beginWork(id)).toThrow(expect.objectContaining({ code: "project-unavailable" }));
  });

  it("rejects invalid histories and does not commit rejected operations", async () => {
    const { ctx, project, objective } = await kit();
    const id = ctx.nodes.create({ projectId: project.id, objective }).node.id;
    const before = ctx.nodes.getEvents(id);
    expect(() => ctx.nodes.unlock(id, " ")).toThrow();
    expect(ctx.nodes.getEvents(id)).toBe(before);
    const created = before[0]!;
    const bad = [
      { ...created, version: 1 }, { ...created, revision: 2 },
      { ...created, nodeId: "other" }, { ...created, timestamp: "invalid" },
      { ...created, type: "material-replaced" }, { ...created, data: null },
    ];
    for (const event of bad) expect(() => projectNode(id, [event as NodeEvent])).toThrow();
    expect(() => projectNode(id, [created, { ...created, revision: 2 }])).toThrow();
    expect(() => projectNode(id, [created, {
      ...created, id: "next" as never, revision: 2, type: "completion-confirmed",
      data: { confirmedBy: "reviewer", reason: "OK", reviewedRevision: 1 },
    }])).toThrow();
    expect(projectNode(createNodeId("missing"), [])).toBeUndefined();
  });
});
