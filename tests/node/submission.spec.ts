import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createResourceId, createSessionId } from "../../src/brand/ids.js";
import type { NodeId } from "../../src/brand/ids.js";
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

async function close(ctx: Context): Promise<void> {
  contexts.splice(contexts.indexOf(ctx), 1);
  await ctx.fiber.dispose();
}

function working(ctx: Context): NodeId {
  const project = ctx.projects.create({ name: "Project", goal: "Research" });
  const id = ctx.nodes.create({ projectId: project.id, objective: {
    title: "Sources", description: "Inspect sources", acceptanceCriteria: ["Cite primary sources", "List gaps"],
  } }).node.id;
  ctx.nodes.unlock(id, "Ready");
  ctx.nodes.bindSession(id, createSessionId(`session-${id}`));
  ctx.nodes.beginWork(id);
  return id;
}

const submission = {
  summary: "Cited three sources",
  resourceIds: [createResourceId("resource-1")],
  criteria: [
    { criterion: "Cite primary sources", satisfied: true, note: "Three sources in resource-1" },
    { criterion: "List gaps", satisfied: false, note: "No gap list yet" },
  ],
  remaining: ["Write the gap list"],
};

describe("Node completion signal", () => {
  it("moves a signaled Turn into review instead of idle and never completes on its own", async () => {
    const ctx = await open();
    const id = working(ctx);
    const signaled = ctx.nodes.signalCompletion(id, submission);
    expect(signaled).toMatchObject({ status: "working", submission: { summary: "Cited three sources" } });
    expect(() => ctx.nodes.signalCompletion(id, submission)).toThrow(expect.objectContaining({ code: "invalid-state" }));
    const ended = ctx.nodes.endWork(id);
    expect(ended.status).toBe("submitted");
    expect(ended.confirmation).toBeUndefined();
    expect(() => ctx.nodes.beginWork(id)).toThrow(expect.objectContaining({ code: "invalid-state" }));
    expect(() => ctx.nodes.signalCompletion(id, submission)).toThrow(expect.objectContaining({ code: "invalid-state" }));
  });

  it("rejects signals that do not check every acceptance criterion in order", async () => {
    const ctx = await open();
    const id = working(ctx);
    for (const invalid of [
      { ...submission, criteria: submission.criteria.slice(0, 1) },
      { ...submission, criteria: [...submission.criteria].reverse() },
      { ...submission, summary: " " },
      { ...submission, resourceIds: [createResourceId("resource-1"), createResourceId("resource-1")] },
    ]) {
      expect(() => ctx.nodes.signalCompletion(id, invalid)).toThrow(expect.objectContaining({ code: "invalid-event-stream" }));
    }
    expect(ctx.nodes.get(id)?.submission).toBeUndefined();
  });

  it("returns rework to idle with feedback that the next Turn clears", async () => {
    const ctx = await open();
    const id = working(ctx);
    ctx.nodes.signalCompletion(id, submission);
    const submitted = ctx.nodes.endWork(id);
    expect(() => ctx.nodes.requestRework(id, { requestedBy: "human", feedback: "Add gaps", reviewedRevision: 1 }))
      .toThrow(expect.objectContaining({ code: "stale-revision" }));
    const reworked = ctx.nodes.requestRework(id, { requestedBy: "human", feedback: "Add gaps", reviewedRevision: submitted.revision });
    expect(reworked).toMatchObject({ status: "idle", pendingFeedback: { requestedBy: "human", feedback: "Add gaps" } });
    expect(reworked.submission).toBeUndefined();
    expect(() => ctx.nodes.requestRework(id, { requestedBy: "human", feedback: "Again", reviewedRevision: reworked.revision }))
      .toThrow(expect.objectContaining({ code: "invalid-state" }));
    expect(ctx.nodes.beginWork(id).pendingFeedback).toBeUndefined();
  });

  it("restores review state and pending feedback after restart, and finishes an interrupted signaled Turn as submitted", async () => {
    const path = await temporaryDatabase(roots, "navo-submit-");
    const ctx = await open(path);
    const reviewed = working(ctx);
    ctx.nodes.signalCompletion(reviewed, submission);
    const submitted = ctx.nodes.endWork(reviewed);
    const pending = ctx.nodes.requestRework(reviewed, { requestedBy: "human", feedback: "Add gaps", reviewedRevision: submitted.revision });
    const interrupted = working(ctx);
    ctx.nodes.signalCompletion(interrupted, submission);
    await close(ctx);

    const restarted = await open(path);
    expect(restarted.nodes.get(reviewed)).toEqual(pending);
    expect(restarted.nodes.get(interrupted)).toMatchObject({ status: "submitted", submission: { summary: "Cited three sources" } });
    expect(storedRows(path, "node").filter(row => row.ownerId === interrupted).map(row => row.type).slice(-2))
      .toEqual(["completion-signaled", "work-ended"]);
    expect(projectNode(interrupted, restarted.nodes.getEvents(interrupted))?.status).toBe("submitted");
  });
});
