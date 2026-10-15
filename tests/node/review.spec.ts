import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createSessionId, createTurnId } from "../../src/brand/ids.js";
import type { NodeId } from "../../src/brand/ids.js";
import type { NodeEvent } from "../../src/node/events.js";
import { projectNode } from "../../src/node/projector.js";
import { NodeStore } from "../../src/node/store.js";
import { ProjectStore } from "../../src/project/store.js";
import { StorageService } from "../../src/storage/database.js";
import { memoryStorage, removeRoots, storedRows, temporaryDatabase } from "../helpers/storage.js";

const contexts: Context[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
  await removeRoots(roots);
});

async function open(path?: string) {
  const ctx = new Context();
  contexts.push(ctx);
  if (path === undefined) await memoryStorage(ctx);
  else await ctx.plugin(StorageService, { path });
  await ctx.plugin(ProjectStore);
  await ctx.plugin(NodeStore);
  return ctx;
}

function idleNode(ctx: Context): NodeId {
  const project = ctx.projects.create({ name: "Project", goal: "Research" });
  const id = ctx.nodes.create({ projectId: project.id, objective: {
    title: "Sources", description: "Inspect sources", acceptanceCriteria: ["Cite primary sources"],
  } }).node.id;
  ctx.nodes.unlock(id, "Ready");
  return id;
}

function ranNode(ctx: Context): NodeId {
  const id = idleNode(ctx);
  ctx.nodes.bindSession(id, createSessionId(`session-${id}`));
  ctx.nodes.beginWork(id);
  ctx.nodes.endWork(id);
  return id;
}

const turnId = createTurnId("turn-1");

describe("Node review records", () => {
  it("writes the decision and the review record in one revision-checked batch", async () => {
    const path = await temporaryDatabase(roots, "navo-review-");
    const ctx = await open(path);
    const id = ranNode(ctx);
    const base = ctx.nodes.get(id)!;
    expect(() => ctx.nodes.recordReview(id, { turnId, decision: "complete", reason: "Verified", reviewedRevision: base.revision - 1 }, undefined))
      .toThrow(expect.objectContaining({ code: "stale-revision" }));
    expect(ctx.nodes.get(id)).toEqual(base);

    const done = ctx.nodes.recordReview(id, { turnId, decision: "complete", reason: "Verified", reviewedRevision: base.revision }, undefined);
    expect(done).toMatchObject({
      status: "completing",
      revision: base.revision + 2,
      confirmation: { confirmedBy: "main", reviewedRevision: base.revision },
      lastReview: { turnId, decision: "complete", reviewedRevision: base.revision },
    });
    expect(storedRows(path, "node").filter(row => row.ownerId === id).map(row => row.type).slice(-2))
      .toEqual(["completion-confirmed", "review-recorded"]);
    expect(() => ctx.nodes.recordReview(id, { turnId, decision: "escalate", reason: "Again", reviewedRevision: done.revision }, undefined))
      .toThrow(expect.objectContaining({ code: "invalid-state" }));
  });

  it("counts rework requests, restores them after restart and keeps escalate from changing the Node", async () => {
    const path = await temporaryDatabase(roots, "navo-review-");
    const ctx = await open(path);
    const id = ranNode(ctx);
    const reworked = ctx.nodes.recordReview(id, {
      turnId, decision: "rework", reason: "Missing sources", reviewedRevision: ctx.nodes.get(id)!.revision,
    }, "Cite the primary source");
    expect(reworked).toMatchObject({
      status: "idle", reworkCount: 1,
      pendingFeedback: { requestedBy: "main", feedback: "Cite the primary source" },
      lastReview: { decision: "rework" },
    });
    const escalated = ctx.nodes.recordReview(id, {
      turnId, decision: "escalate", reason: "Needs Human", reviewedRevision: reworked.revision,
    }, undefined);
    expect(escalated).toMatchObject({ status: "idle", reworkCount: 1, revision: reworked.revision + 1 });
    expect(escalated.pendingFeedback).toEqual(reworked.pendingFeedback);
    await ctx.fiber.dispose();
    contexts.splice(contexts.indexOf(ctx), 1);

    const restarted = await open(path);
    expect(restarted.nodes.get(id)).toEqual(escalated);
  });

  it("rejects review-recorded events for locked Nodes and impossible revisions", async () => {
    const ctx = await open();
    const project = ctx.projects.create({ name: "Project", goal: "Research" });
    const locked = ctx.nodes.create({ projectId: project.id, objective: {
      title: "Sources", description: "Inspect", acceptanceCriteria: ["Cite"],
    } }).node.id;
    expect(() => ctx.nodes.recordReview(locked, { decision: "escalate", reason: "x", reviewedRevision: 1 }, undefined))
      .toThrow(expect.objectContaining({ code: "invalid-state" }));
    const id = ranNode(ctx);
    const history = ctx.nodes.getEvents(id);
    const record = (revision: number): NodeEvent => ({
      version: 2, id: "review-event" as never, nodeId: id, revision: history.length + 1,
      timestamp: "2026-10-15T00:00:00.000Z", type: "review-recorded",
      data: { decision: "escalate", reason: "x", reviewedRevision: revision },
    });
    expect(() => projectNode(id, [...history, record(history.length + 5)])).toThrow(/invalid Node revision/);
    expect(projectNode(id, [...history, record(history.length)])?.lastReview?.decision).toBe("escalate");
  });

  it("allows rework from idle only through the review path", async () => {
    const ctx = await open();
    const id = ranNode(ctx);
    expect(() => ctx.nodes.requestRework(id, { requestedBy: "human", feedback: "Fix", reviewedRevision: ctx.nodes.get(id)!.revision }))
      .toThrow(expect.objectContaining({ code: "invalid-state" }));
    expect(ctx.nodes.recordReview(id, {
      decision: "rework", reason: "Never produced anything", reviewedRevision: ctx.nodes.get(id)!.revision,
    }, "Produce the report").status).toBe("idle");
  });
});
