import { describe, expect, it } from "vitest";

import { SUMMARY_OPEN_TAG } from "../../../src/context/compaction/summarizer.js";
import { createDataset, type Dataset } from "../../../scripts/compaction/data.js";
import { materializeHandoff } from "../../../scripts/compaction/handoff.js";
import { assertRestart, captureRestartState } from "../../../scripts/compaction/state.js";
import { watchSecondCompaction } from "../../../scripts/compaction/watch.js";
import { createProject, createWorld, sessionEvents } from "./helpers.js";
import { MAIN_COMPACTING } from "./models.js";
import {
  reviewReplies,
  submitReply,
  summaryReply,
  textReply,
  toolReply,
} from "./script.js";
import { assertSurfacePairs, completedCompactions } from "./verify.js";

function summaryText(dataset: Dataset): string {
  const expected = dataset.expected;
  return JSON.stringify({
    batches: expected.batches.map(batch => ({
      batch: batch.batch,
      records: batch.records,
      sum: batch.sum,
      anomalies: batch.anomalies,
    })),
    totalRecords: expected.totalRecords,
    totalSum: expected.totalSum,
    totalAnomalies: expected.totalAnomalies,
    anomalyRecords: [...expected.anomalyRecords],
  });
}

describe("F12.7 pause observer", () => {
  it("pauses after two pressure compactions once the submitted node event commits", async () => {
    const dataset = createDataset();
    const summary = summaryText(dataset);
    const world = await createWorld({
      model: MAIN_COMPACTING,
      summary: () => summaryReply(),
      tasks: [
        toolReply("watch-a1", "watch-call-1"),
        textReply("watch-a2"),
        toolReply("watch-b1", "watch-call-2"),
        textReply("watch-b2"),
        textReply("watch-c1"),
        textReply("watch-d1"),
        textReply("watch-e1"),
        submitReply("watch-submit", summary),
        ...reviewReplies("watch-review", "complete"),
      ],
    });
    let app = await world.open();
    const { project, nodeIds } = await createProject(app, world.workspaceRoot, ["Pause Node"]);
    const nodeA = nodeIds[0]!;
    const watch = watchSecondCompaction(app, project.id, nodeA);
    let paused;
    try {
      paused = await app.autoRun.start(project.id);
    } finally {
      watch.dispose();
    }

    expect(watch.pauseError).toBeNull();
    expect(watch.completed).toBeGreaterThanOrEqual(2);
    expect(paused).toMatchObject({ status: "paused", reason: "human-paused", mainTurns: 0 });
    expect(app.nodes.get(nodeA)?.status).toBe("submitted");
    expect(app.projectRuntime.isNodeActive(nodeA)).toBe(false);
    expect(app.projectRuntime.isMainActive(project.id)).toBe(false);

    const sessionId = app.nodes.get(nodeA)!.sessionId!;
    const events = sessionEvents(app, sessionId);
    expect(completedCompactions(events)).toBeGreaterThanOrEqual(2);
    expect(events.filter(event => event.type === "compaction-started" && event.data.trigger === "pressure").length)
      .toBeGreaterThanOrEqual(2);
    const derived = app.sessions.deriveMessages(sessionId);
    assertSurfacePairs(derived);
    expect(derived.some(message => message.content.some(
      block => block.type === "text" && block.text.includes(SUMMARY_OPEN_TAG),
    ))).toBe(true);

    const handoff = await materializeHandoff(app, project.id, world.workspaceRoot, nodeA, dataset);
    expect(handoff.original.text).toBe(summary);
    const before = captureRestartState(app, project.id);
    const requestsBefore = world.requests();
    app = await world.restart(app);
    expect(world.requests()).toBe(requestsBefore);
    assertRestart(before, captureRestartState(app, project.id));

    const resumed = await app.autoRun.start(project.id);
    expect(app.sessions.getEvents(project.mainSessionId).filter(event => event.type === "error")).toEqual([]);
    expect(resumed).toMatchObject({ status: "completed", reason: "roadmap-complete", mainTurns: 1 });
    expect(app.nodes.get(nodeA)?.status).toBe("completing");
    expect(app.nodes.get(nodeA)?.lastReview?.decision).toBe("complete");
  }, 15_000);
});
