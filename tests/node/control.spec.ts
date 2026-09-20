import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";
import { createEventId, createNodeId, createSessionId } from "../../src/brand/ids.js";
import { NodeStore } from "../../src/node/store.js";
import { projectNode } from "../../src/node/projector.js";
import { NodeTurnContextBuilder } from "../../src/node/context.js";
import { ProjectStore } from "../../src/project/store.js";
import type { NodeEvent } from "../../src/node/events.js";

const contexts: Context[] = [];
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())); });

async function kit() {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(ProjectStore);
  await ctx.plugin(NodeStore);
  return { ctx, projectId: ctx.projects.create({ goal: "Research" }).id };
}

describe("control nodes", () => {
  it.each(["start", "end", "checkpoint"] as const)("supports manual %s confirmation without an Agent", async purpose => {
    const { ctx, projectId } = await kit();
    const created = ctx.nodes.create({ projectId, kind: "control", purpose, title: "Review point" });
    const id = created.node.id;
    expect(created).toMatchObject({ node: { kind: "control", purpose }, status: "locked" });
    ctx.nodes.unlock(id, "Review");
    expect(() => ctx.nodes.bindSession(id, createSessionId("forbidden"))).toThrow(expect.objectContaining({ code: "invalid-state" }));
    expect(() => ctx.nodes.beginWork(id)).toThrow(expect.objectContaining({ code: "invalid-state" }));
    expect(() => new NodeTurnContextBuilder(ctx).build(ctx.nodes.get(id)!)).toThrow();
    ctx.nodes.lock(id, "Not ready");
    const idle = ctx.nodes.unlock(id, "Ready");
    expect(() => ctx.nodes.confirmCompletion(id, { confirmedBy: "human", reason: "Accepted", reviewedRevision: idle.revision - 1 })).toThrow();
    const complete = ctx.nodes.confirmCompletion(id, { confirmedBy: "human", reason: "Accepted", reviewedRevision: idle.revision });
    expect(complete.status).toBe("completing");
    expect(complete.sessionId).toBeUndefined();
    expect(() => ctx.nodes.unlock(id, "Again")).toThrow();
    expect(projectNode(id, JSON.parse(JSON.stringify(ctx.nodes.getEvents(id))))).toEqual(complete);
  });

  it("rejects forged session and work events during replay", async () => {
    const { ctx, projectId } = await kit();
    const id = ctx.nodes.create({ projectId, kind: "control", purpose: "start", title: "Begin" }).node.id;
    ctx.nodes.unlock(id, "Ready");
    const history = ctx.nodes.getEvents(id);
    const base = { version: 2 as const, nodeId: id, id: createEventId("forged"), revision: 3, timestamp: new Date().toISOString() };
    for (const event of [
      { ...base, type: "session-bound", data: { sessionId: createSessionId("no") } },
      { ...base, type: "work-started", data: {} },
    ]) expect(() => projectNode(id, [...history, event as NodeEvent])).toThrow();
  });

  it("rejects invalid controls and whole creation batches without partial publication", async () => {
    const { ctx, projectId } = await kit();
    const a = createNodeId("a");
    expect(() => ctx.nodes.createBatch([
      { nodeId: a, input: { projectId, kind: "control", purpose: "start", title: "Start" } },
      { nodeId: createNodeId("b"), input: { projectId, kind: "control", purpose: "end", title: " " } },
    ])).toThrow();
    expect(ctx.nodes.get(a)).toBeUndefined();
    expect(() => ctx.nodes.create({ projectId, kind: "control", purpose: "bad" as never, title: "X" })).toThrow();
    const observed: string[] = [];
    ctx.on("node/event", event => { observed.push(event.type); });
    const id = ctx.nodes.create({ projectId, kind: "control", purpose: "end", title: "End" }).node.id;
    ctx.nodes.unlock(id, "Ready");
    await Promise.resolve();
    expect(observed).toEqual(["control-created", "node-unlocked"]);
  });
});
