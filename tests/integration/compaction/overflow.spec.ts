import { describe, expect, it } from "vitest";

import { createProject, createWorld, messageText, sessionEvents } from "./helpers.js";
import { UNBOUNDED } from "./models.js";
import {
  overflowReply,
  reviewReplies,
  submitReply,
  summaryFailure,
  summaryReply,
  textReply,
} from "./script.js";
import {
  assertSelectionPairs,
  assertSurfacePairs,
  assertToolPairs,
  compactionEvents,
  completedCompactions,
} from "./verify.js";

describe("F12.7 overflow recovery acceptance", () => {
  it("recovers an ordinary request overflow with one checkpoint and one retry", async () => {
    const world = await createWorld({
      model: UNBOUNDED,
      summary: () => summaryReply(),
      tasks: [
        textReply("overflow-seed"),
        overflowReply(),
        submitReply("submit-after-overflow"),
        ...reviewReplies("review-after-overflow", "complete"),
      ],
    });
    const app = await world.open();
    const { project, nodeIds } = await createProject(app, world.workspaceRoot, ["Recover"]);

    const result = await app.autoRun.start(project.id);

    expect(result).toMatchObject({ status: "completed", reason: "roadmap-complete", nodeTurns: 2, mainTurns: 1 });
    expect(world.purposes()).toEqual(["task", "task", "summary", "task", "task", "task"]);
    const sessionId = app.nodes.get(nodeIds[0]!)!.sessionId!;
    const events = sessionEvents(app, sessionId);
    expect(events.filter(event => event.type === "compaction-started")).toHaveLength(1);
    expect(events.find(event => event.type === "compaction-started")).toMatchObject({
      data: { trigger: "overflow" },
    });
    expect(events.filter(event => event.type === "compaction-checkpoint")).toHaveLength(1);
    expect(completedCompactions(events)).toBe(1);
    assertSelectionPairs(events);
    assertToolPairs(events);
    assertSurfacePairs(app.sessions.deriveMessages(sessionId));

    const retry = world.taskRequests()[2]!;
    expect(messageText(retry.request)).toContain("<compacted-summary>");
    expect(messageText(retry.request)).not.toContain("overflow-seed");
  }, 15_000);

  it("fails the Turn and pauses AutoRun when overflow has no safe history", async () => {
    const world = await createWorld({ model: UNBOUNDED, tasks: [overflowReply()] });
    const app = await world.open();
    const { project, nodeIds } = await createProject(app, world.workspaceRoot, ["No History"]);

    const result = await app.autoRun.start(project.id);

    expect(result).toMatchObject({ status: "paused", reason: "turn-failed", nodeTurns: 1, mainTurns: 0 });
    expect(world.purposes()).toEqual(["task"]);
    const sessionId = app.nodes.get(nodeIds[0]!)!.sessionId!;
    const events = sessionEvents(app, sessionId);
    expect(compactionEvents(events)).toHaveLength(0);
    expect(events.find(event => event.type === "turn-ended")).toMatchObject({ data: { status: "failed" } });
    expect(app.nodes.get(nodeIds[0]!)?.status).toBe("idle");
  });

  it("fails the Turn and pauses AutoRun when the overflow summary fails", async () => {
    const world = await createWorld({
      model: UNBOUNDED,
      tasks: [textReply("failure-seed"), overflowReply()],
      summary: summaryFailure,
    });
    const app = await world.open();
    const { project, nodeIds } = await createProject(app, world.workspaceRoot, ["Summary Failure"]);

    const result = await app.autoRun.start(project.id);

    expect(result).toMatchObject({ status: "paused", reason: "turn-failed", nodeTurns: 2, mainTurns: 0 });
    expect(world.purposes()).toEqual(["task", "task", "summary"]);
    const sessionId = app.nodes.get(nodeIds[0]!)!.sessionId!;
    const events = sessionEvents(app, sessionId);
    expect(events.filter(event => event.type === "compaction-started")).toHaveLength(1);
    expect(events.filter(event => event.type === "compaction-checkpoint")).toHaveLength(0);
    expect(events.find(event => event.type === "compaction-ended")).toMatchObject({
      data: { status: "failed", failure: { code: "context-compaction-failed" } },
    });
    expect(world.taskRequests()).toHaveLength(2);
    expect(app.nodes.get(nodeIds[0]!)?.status).toBe("idle");
  });
});
