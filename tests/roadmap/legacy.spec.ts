import { DatabaseSync } from "node:sqlite";

import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createNodeId, createProjectId } from "../../src/brand/ids.js";
import type { NodeId } from "../../src/brand/ids.js";
import { NodeStore } from "../../src/node/store.js";
import { ProjectStore } from "../../src/project/store.js";
import { bypassLegacyNodes } from "../../src/roadmap/legacy.js";
import { RoadmapStore } from "../../src/roadmap/store.js";
import { StorageService } from "../../src/storage/database.js";
import { removeRoots, storedRows, temporaryDatabase } from "../helpers/storage.js";

const contexts: Context[] = [];
const roots: string[] = [];
const timestamp = "2026-10-01T00:00:00.000Z";

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

function nodeEvents(nodeId: string, entries: readonly (readonly [string, Record<string, unknown>])[]) {
  return entries.map(([type, data], index) => ({
    version: 2, id: `${nodeId}-${index + 1}`, nodeId, revision: index + 1, timestamp, type, data,
  }));
}

function insert(path: string, domain: string, ownerId: string, projectId: string, events: readonly unknown[]): void {
  const db = new DatabaseSync(path);
  try {
    const statement = db.prepare("INSERT INTO events (domain, owner_id, seq, project_id, payload) VALUES (?, ?, ?, ?, ?)");
    events.forEach((event, index) => statement.run(domain, ownerId, index + 1, projectId, JSON.stringify(event)));
  } finally {
    db.close();
  }
}

const confirmed = (reviewedRevision: number) => ({ confirmedBy: "human", reason: "Accepted", reviewedRevision });
const objective = (title: string) => ({ title, description: `Do ${title}`, acceptanceCriteria: [`${title} done`] });

async function legacyDatabase() {
  const path = await temporaryDatabase(roots, "navo-legacy-");
  const ctx = await open(path);
  const projectId = ctx.projects.create({ name: "Legacy", goal: "Legacy plan" }).id;
  await close(ctx);
  const [start, a, checkpoint, b, end] = ["start", "a", "checkpoint", "b", "end"].map(createNodeId) as [NodeId, NodeId, NodeId, NodeId, NodeId];
  const control = (purpose: string, title: string) => ["control-created", { projectId, purpose, title, requirement: "required" }] as const;
  insert(path, "node", start, projectId, nodeEvents(start, [
    control("start", "Start"), ["node-unlocked", { reason: "Ready" }], ["completion-confirmed", confirmed(2)],
  ]));
  insert(path, "node", a, projectId, nodeEvents(a, [
    ["node-created", { projectId, objective: objective("A"), requirement: "required" }],
    ["node-unlocked", { reason: "Required dependencies resolved" }],
    ["completion-confirmed", confirmed(2)],
  ]));
  insert(path, "node", checkpoint, projectId, nodeEvents(checkpoint, [
    control("checkpoint", "Review"), ["node-unlocked", { reason: "Required dependencies resolved" }],
    ["definition-changed", { definition: { kind: "control", purpose: "checkpoint", title: "Final review" }, requirement: "required", reason: "Rename", reviewedRevision: 2 }],
  ]));
  insert(path, "node", b, projectId, nodeEvents(b, [
    ["node-created", { projectId, objective: objective("B"), requirement: "required" }],
    ["definition-changed", { definition: { kind: "work", objective: objective("B2") }, requirement: "required", reason: "Clarify", reviewedRevision: 1 }],
  ]));
  insert(path, "node", end, projectId, nodeEvents(end, [control("end", "End")]));
  const header = (revision: number) => ({ version: 1, id: `roadmap-${revision}`, projectId, revision, baseRevision: revision - 1, timestamp, reason: "Plan" });
  insert(path, "roadmap", projectId, projectId, [
    { ...header(1), type: "roadmap-created", definition: {
      projectId, nodes: [start, a, checkpoint, b], edges: [{ from: start, to: a }, { from: a, to: checkpoint }, { from: checkpoint, to: b }],
    } },
    { ...header(2), type: "roadmap-changed", changes: [{ type: "insert", nodeId: end }, { type: "connect", edge: { from: b, to: end } }] },
    { ...header(3), type: "roadmap-changed", changes: [{ type: "update-node", nodeId: checkpoint }] },
  ]);
  return { path, projectId, a, b, start, checkpoint, end };
}

describe("legacy control Nodes", () => {
  it("bypasses chains of control Nodes into deduplicated work edges", () => {
    const projectId = createProjectId("project");
    const [a, b, c, x, y, z] = ["a", "b", "c", "x", "y", "z"].map(createNodeId) as [NodeId, NodeId, NodeId, NodeId, NodeId, NodeId];
    const definition = {
      projectId,
      nodes: [x, a, y, z, b, c],
      edges: [{ from: x, to: a }, { from: a, to: y }, { from: y, to: z }, { from: z, to: b }, { from: a, to: b }, { from: y, to: c }],
    };
    expect(bypassLegacyNodes(definition, new Set([x, y, z]))).toEqual({
      projectId, nodes: [a, b, c], edges: [{ from: a, to: b }, { from: a, to: c }],
    });
    const plain = { projectId, nodes: [a, b], edges: [{ from: a, to: b }] };
    expect(bypassLegacyNodes(plain, new Set([x]))).toBe(plain);
  });

  it("recovers a legacy Project with only its work Nodes and bypassed edges", async () => {
    const { path, projectId, a, b, start, checkpoint, end } = await legacyDatabase();
    const legacyRows = storedRows(path, "node").filter(row => [start, checkpoint, end].includes(row.ownerId as NodeId));

    const ctx = await open(path);
    const map = ctx.roadmaps.map(projectId);
    expect(map.nodes.map(node => node.node.id)).toEqual([a, b]);
    expect(map.edges).toEqual([{ from: a, to: b }]);
    expect(map.roadmapRevision).toBe(3);
    expect(ctx.nodes.getByProject(projectId).map(node => node.node.id)).toEqual([a, b]);
    expect(ctx.nodes.get(a)).toMatchObject({ status: "completing", revision: 3, confirmation: confirmed(2) });
    expect(ctx.nodes.get(b)).toMatchObject({ status: "idle", revision: 3, node: { objective: objective("B2") } });
    expect(ctx.nodes.get(start)).toBeUndefined();
    expect(storedRows(path, "node").filter(row => row.ownerId === b).map(row => row.type))
      .toEqual(["node-created", "definition-changed", "node-unlocked"]);
    expect(storedRows(path, "node").filter(row => [start, checkpoint, end].includes(row.ownerId as NodeId))).toEqual(legacyRows);
    expect(storedRows(path, "roadmap")).toHaveLength(3);
    await close(ctx);
  });

  it("keeps later Roadmap changes replayable after legacy events", async () => {
    const { path, projectId, a, b } = await legacyDatabase();
    const ctx = await open(path);
    const c = createNodeId("c");
    ctx.roadmaps.change({
      projectId, baseRevision: 3, reason: "Extend",
      newNodes: [{ nodeId: c, input: { projectId, objective: objective("C") } }],
      changes: [{ type: "insert", nodeId: c, index: 1 }, { type: "connect", edge: { from: a, to: c } }, { type: "disconnect", edge: { from: a, to: b } }],
    });
    const before = ctx.roadmaps.get(projectId);
    expect(before?.graph.definition).toEqual({ projectId, nodes: [a, c, b], edges: [{ from: a, to: c }] });
    await close(ctx);

    const restarted = await open(path);
    expect(restarted.roadmaps.get(projectId)).toEqual(before);
    expect(restarted.nodes.get(b)?.status).toBe("idle");
    await close(restarted);
  });
});
