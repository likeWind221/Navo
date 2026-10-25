import { describe, expect, it } from "vitest";

import {
  createProject,
  createWorld,
  messageText,
  seedHistory,
  sessionEvents,
} from "./helpers.js";
import { MAIN_COMPACTING, NODE_COMPACTING } from "./models.js";
import {
  reviewReplies,
  submitReply,
  summaryReply,
  textReply,
  toolReply,
} from "./script.js";
import {
  assertSelectionPairs,
  assertSurfacePairs,
  assertToolPairs,
  completedCompactions,
  summaryCount,
} from "./verify.js";

describe("F12.7 pressure compaction acceptance", () => {
  it("pressure-compacts one Node Session repeatedly and still completes dependent reviews", async () => {
    const world = await createWorld({
      model: MAIN_COMPACTING,
      summary: () => summaryReply(),
      tasks: [
        toolReply("a1", "a-call-1", 16_000), textReply("a2", 16_000),
        toolReply("b1", "b-call-1", 16_000), textReply("b2", 16_000),
        textReply("c1", 16_000), textReply("d1", 16_000), submitReply("submit-a"),
        ...reviewReplies("review-a", "complete"),
        submitReply("submit-b"),
        ...reviewReplies("review-b", "complete"),
      ],
    });
    const app = await world.open();
    const { project, nodeIds } = await createProject(app, world.workspaceRoot, ["Investigate", "Deliver"]);

    const result = await app.autoRun.start(project.id);

    expect(result).toMatchObject({
      status: "completed",
      reason: "roadmap-complete",
      nodeTurns: 6,
      mainTurns: 2,
    });
    expect(app.nodes.get(nodeIds[0]!)?.status).toBe("completing");
    expect(app.nodes.get(nodeIds[1]!)?.status).toBe("completing");

    const sessionId = app.nodes.get(nodeIds[0]!)!.sessionId!;
    const events = sessionEvents(app, sessionId);
    const starts = events.filter(event => event.type === "compaction-started");
    const completedIds = new Set(events.flatMap(event =>
      event.type === "compaction-ended" && event.data.status === "completed"
        ? [event.data.compactionId]
        : []));
    const completedStarts = starts.filter(event => completedIds.has(event.data.compactionId));
    expect(completedCompactions(events)).toBeGreaterThanOrEqual(2);
    expect(completedStarts.filter(event => event.data.trigger === "pressure").length)
      .toBeGreaterThanOrEqual(2);
    expect(completedStarts).toHaveLength(starts.length);
    assertSelectionPairs(events);
    assertToolPairs(events);
    assertSurfacePairs(app.sessions.deriveMessages(sessionId));
    for (const record of world.records().filter(record => record.purpose === "task")) {
      assertSurfacePairs(record.request.messages);
    }
    expect(summaryCount(world.purposes())).toBe(starts.length);
    expect(world.records().filter(record => record.purpose === "summary")
      .every(record => record.request.tools === undefined)).toBe(true);
  });

  it("pressure-compacts Main and reviews the current Node revision", async () => {
    const world = await createWorld({
      model: MAIN_COMPACTING,
      summary: () => summaryReply(),
      tasks: [submitReply("submit-node"), ...reviewReplies("review-current", "complete")],
    });
    const app = await world.open();
    const { project, nodeIds } = await createProject(app, world.workspaceRoot, ["Reviewed Node"]);
    seedHistory(app, project.mainSessionId, 60, 500);

    const result = await app.autoRun.start(project.id);

    expect(result).toMatchObject({ status: "completed", reason: "roadmap-complete", nodeTurns: 1, mainTurns: 1 });
    const mainEvents = sessionEvents(app, project.mainSessionId);
    expect(completedCompactions(mainEvents)).toBeGreaterThanOrEqual(1);
    assertToolPairs(mainEvents);
    assertSurfacePairs(app.sessions.deriveMessages(project.mainSessionId));

    const reviewRequest = world.taskRequests().find(record =>
      messageText(record.request).includes("Automatically review this Node submission"))!;
    expect(messageText(reviewRequest.request)).toContain("<compacted-summary>");
    expect(messageText(reviewRequest.request)).toContain("Automatically review this Node submission");
    expect(reviewRequest.request.tools?.map(tool => tool.name)).toEqual(expect.arrayContaining([
      "submit_review",
      "read_node_turn",
    ]));
    const workEnded = app.nodes.getEvents(nodeIds[0]!).find(event => event.type === "work-ended")!;
    const reviewed = app.nodes.get(nodeIds[0]!)!;
    expect(reviewed.lastReview).toMatchObject({ decision: "complete", reviewedRevision: workEnded.revision });
    expect(reviewed.status).toBe("completing");
  }, 15_000);
});
