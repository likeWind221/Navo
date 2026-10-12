import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createNodeId, createSessionId } from "../../src/brand/ids.js";
import type { NodeId, ProjectId } from "../../src/brand/ids.js";
import { NodeStore } from "../../src/node/store.js";
import { ProjectStore } from "../../src/project/store.js";
import { RoadmapStore } from "../../src/roadmap/store.js";
import { StorageService } from "../../src/storage/database.js";
import { rawSql, removeRoots, storedRows, temporaryDatabase } from "../helpers/storage.js";

const contexts: Context[] = [];
const roots: string[] = [];
const objective = { title: "Research", description: "Inspect sources", acceptanceCriteria: ["Sources reviewed"] };

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
  await removeRoots(roots);
});

async function open(path: string): Promise<Context> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(StorageService, { path });
  await ctx.plugin(ProjectStore);
  await ctx.plugin(NodeStore);
  await ctx.plugin(RoadmapStore);
  return ctx;
}

async function close(ctx: Context): Promise<void> {
  contexts.splice(contexts.indexOf(ctx), 1);
  await ctx.fiber.dispose();
}

async function seeded() {
  const path = await temporaryDatabase(roots, "navo-roadmap-");
  const ctx = await open(path);
  const projectId = ctx.projects.create({ name: "Project", goal: "Research project" }).id;
  const [a, b, c] = [createNodeId("a"), createNodeId("b"), createNodeId("c")];
  ctx.roadmaps.create({
    definition: { projectId, nodes: [a, b, c], edges: [{ from: a, to: b }] },
    reason: "Initial",
    newNodes: [a, b, c].map(nodeId => ({ nodeId, input: { projectId, objective } })),
  });
  return { path, ctx, projectId, a, b, c };
}

function settle(): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, 0));
}

async function observe(ctx: Context): Promise<{ nodeEvents: string[]; projectChanges: ProjectId[] }> {
  await settle();
  const seen = { nodeEvents: [] as string[], projectChanges: [] as ProjectId[] };
  ctx.on("node/event", event => { seen.nodeEvents.push(`${event.nodeId}:${event.type}`); });
  ctx.on("project/changed", projectId => { seen.projectChanges.push(projectId); });
  return seen;
}

function state(ctx: Context, projectId: ProjectId, ids: readonly NodeId[]) {
  return {
    map: ctx.roadmaps.map(projectId),
    roadmapEvents: ctx.roadmaps.getEvents(projectId),
    nodeEvents: ids.map(id => ctx.nodes.getEvents(id)),
  };
}

function confirmation(ctx: Context, nodeId: NodeId) {
  return { confirmedBy: "human" as const, reason: "Reviewed", reviewedRevision: ctx.nodes.get(nodeId)!.revision };
}

describe("Roadmap and Node persistence", () => {
  it("stores a Roadmap creation, its new Nodes and the automatic unlocks as one commit", async () => {
    const { path, a, b, c } = await seeded();

    expect(storedRows(path, "node")).toEqual([
      { ownerId: a, seq: 1, type: "node-created" },
      { ownerId: a, seq: 2, type: "node-unlocked" },
      { ownerId: b, seq: 1, type: "node-created" },
      { ownerId: c, seq: 1, type: "node-created" },
      { ownerId: c, seq: 2, type: "node-unlocked" },
    ]);
    expect(storedRows(path, "roadmap")).toMatchObject([{ seq: 1, type: "roadmap-created" }]);
  });

  it("restores Roadmap history and every Node state after human controls and a Roadmap change", async () => {
    const { path, ctx, projectId, a, b, c } = await seeded();
    const d = createNodeId("d");
    ctx.nodes.lock(c, "Wait for input");
    ctx.nodes.unlock(c, "Input arrived");
    ctx.nodes.bindSession(a, createSessionId("session-a"));
    ctx.nodes.beginWork(a);
    ctx.nodes.endWork(a);
    ctx.nodes.confirmCompletion(a, confirmation(ctx, a));
    ctx.nodes.skip(b, confirmation(ctx, b));
    ctx.roadmaps.change({
      projectId, baseRevision: 1, reason: "Follow-up",
      newNodes: [{ nodeId: d, input: { projectId, objective } }],
      changes: [{ type: "insert", nodeId: d }, { type: "connect", edge: { from: b, to: d } }],
    });
    const ids = [a, b, c, d];
    const before = state(ctx, projectId, ids);
    expect(before.map.nodes.map(node => node.status)).toEqual(["completing", "skipped", "idle", "idle"]);
    expect(before.nodeEvents[0]!.map(event => event.type)).toEqual([
      "node-created", "node-unlocked", "session-bound", "work-started", "work-ended", "completion-confirmed",
    ]);
    const rows = storedRows(path, "node").length + storedRows(path, "roadmap").length;
    await close(ctx);

    const restarted = await open(path);
    expect(state(restarted, projectId, ids)).toEqual(before);
    expect(storedRows(path, "node").length + storedRows(path, "roadmap").length).toBe(rows);

    restarted.nodes.confirmCompletion(d, confirmation(restarted, d));
    await close(restarted);
    expect((await open(path)).nodes.get(d)).toMatchObject({ status: "completing", revision: 3 });
  });

  it("keeps Nodes, Roadmap and notifications unchanged when a Roadmap creation cannot be stored", async () => {
    const path = await temporaryDatabase(roots, "navo-roadmap-");
    const ctx = await open(path);
    const projectId = ctx.projects.create({ name: "Project", goal: "Research project" }).id;
    const seen = await observe(ctx);
    rawSql(path, "CREATE TRIGGER fail_roadmap BEFORE INSERT ON events WHEN NEW.domain = 'roadmap' BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    const a = createNodeId("a");

    expect(() => ctx.roadmaps.create({
      definition: { projectId, nodes: [a], edges: [] }, reason: "Initial",
      newNodes: [{ nodeId: a, input: { projectId, objective } }],
    })).toThrow(expect.objectContaining({ name: "StorageError", code: "write-failed" }));
    await settle();

    expect(ctx.roadmaps.get(projectId)).toBeUndefined();
    expect(ctx.nodes.get(a)).toBeUndefined();
    expect(storedRows(path, "node")).toEqual([]);
    expect(seen).toEqual({ nodeEvents: [], projectChanges: [] });
  });

  it("keeps a Roadmap change, its new Node and its unlocks out of storage and memory together", async () => {
    const { path, ctx, projectId, a, b } = await seeded();
    ctx.nodes.confirmCompletion(a, confirmation(ctx, a));
    ctx.nodes.skip(b, confirmation(ctx, b));
    const before = state(ctx, projectId, [a, b]);
    const rows = storedRows(path, "node");
    const seen = await observe(ctx);
    rawSql(path, "CREATE TRIGGER fail_roadmap BEFORE INSERT ON events WHEN NEW.domain = 'roadmap' BEGIN SELECT RAISE(ABORT, 'disk full'); END");
    const d = createNodeId("d");

    expect(() => ctx.roadmaps.change({
      projectId, baseRevision: 1, reason: "Follow-up",
      newNodes: [{ nodeId: d, input: { projectId, objective } }],
      changes: [{ type: "insert", nodeId: d }, { type: "connect", edge: { from: b, to: d } }],
    })).toThrow(expect.objectContaining({ code: "write-failed" }));
    await settle();

    expect(state(ctx, projectId, [a, b])).toEqual(before);
    expect(ctx.nodes.get(d)).toBeUndefined();
    expect(storedRows(path, "node")).toEqual(rows);
    expect(seen).toEqual({ nodeEvents: [], projectChanges: [] });
  });

  it("keeps a confirmed completion and its downstream unlock out of memory when storing fails", async () => {
    const { path, ctx, a, b } = await seeded();
    const seen = await observe(ctx);
    rawSql(path, "CREATE TRIGGER fail_unlock BEFORE INSERT ON events WHEN NEW.owner_id = 'b' BEGIN SELECT RAISE(ABORT, 'disk full'); END");

    expect(() => ctx.nodes.confirmCompletion(a, confirmation(ctx, a)))
      .toThrow(expect.objectContaining({ code: "write-failed" }));
    await settle();

    expect(ctx.nodes.get(a)?.status).toBe("idle");
    expect(ctx.nodes.get(b)?.status).toBe("locked");
    expect(storedRows(path, "node").filter(row => row.ownerId === a)).toHaveLength(2);
    expect(seen.nodeEvents).toEqual([]);
  });

  it("refuses to start when a stored Roadmap or Node history is invalid", async () => {
    const filed = await seeded();
    await close(filed.ctx);
    rawSql(filed.path, `UPDATE events SET project_id = 'other' WHERE domain = 'node' AND owner_id = '${filed.c}'`);
    await expect(open(filed.path)).rejects.toMatchObject({
      name: "StorageError", code: "invalid-record", message: expect.stringContaining(`node history ${filed.c}`),
    });

    const missing = await seeded();
    await close(missing.ctx);
    rawSql(missing.path, `DELETE FROM events WHERE domain = 'node' AND owner_id = '${missing.b}'`);
    await expect(open(missing.path)).rejects.toMatchObject({
      name: "StorageError", code: "invalid-record", message: expect.stringContaining(`roadmap history ${missing.projectId}`),
    });
  });
});
