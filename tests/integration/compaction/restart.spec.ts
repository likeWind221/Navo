import { describe, expect, it } from "vitest";

import {
  CHECKPOINT_MARKER,
  CURRENT_TURN_MARKER,
  ORIGINAL_HISTORY_MARKER,
  prepareInterruptedFixture,
} from "./fixture.js";
import {
  createProject,
  createWorld,
  messageText,
  messagesText,
  sessionEvents,
} from "./helpers.js";
import { NODE_COMPACTING, UNBOUNDED } from "./models.js";
import {
  gatedTextReply,
  reviewReplies,
  submitReply,
  summaryReply,
  textReply,
  toolReply,
} from "./script.js";
import {
  assertInterruptedRepair,
  assertSurfacePairs,
  completedCompactions,
  loggedMessageIds,
} from "./verify.js";

describe("F12.7 restart acceptance", () => {
  it("keeps a committed checkpoint across restart and completes only after an explicit start", async () => {
    const gated = gatedTextReply("pause-c1");
    const world = await createWorld({
      model: NODE_COMPACTING,
      tasks: [
        toolReply("pause-a1", "pause-call-1"), textReply("pause-a2"), textReply("pause-b1"),
        gated.entry,
        submitReply("pause-submit"),
        ...reviewReplies("pause-review", "complete"),
      ],
      summary: () => summaryReply("PAUSE_CHECKPOINT_SUMMARY"),
    });
    let app = await world.open();
    const { project, nodeIds } = await createProject(app, world.workspaceRoot, ["Pause Boundary"]);

    const running = app.autoRun.start(project.id);
    await gated.started;
    const nodeId = nodeIds[0]!;
    const sessionId = app.nodes.get(nodeId)!.sessionId!;
    expect(completedCompactions(app.sessions.getEvents(sessionId))).toBeGreaterThanOrEqual(1);
    expect(app.autoRun.pause(project.id).status).toBe("running");
    gated.release();
    const paused = await running;

    expect(paused).toMatchObject({ status: "paused", reason: "human-paused", nodeTurns: 3 });
    const eventsBefore = app.sessions.getEvents(sessionId);
    const messagesBefore = app.sessions.deriveMessages(sessionId);
    expect(completedCompactions(eventsBefore)).toBeGreaterThanOrEqual(1);
    expect(messagesText(messagesBefore)).toContain("PAUSE_CHECKPOINT_SUMMARY");
    expect(app.nodes.get(nodeId)?.status).toBe("idle");
    const requestsBefore = world.requests();
    const roadmapBefore = app.roadmaps.get(project.id);
    const nodeBefore = app.nodes.get(nodeId);

    app = await world.restart(app);

    expect(world.requests()).toBe(requestsBefore);
    expect(app.autoRun.get(project.id)).toBeUndefined();
    expect(app.sessions.getEvents(sessionId)).toEqual(eventsBefore);
    expect(app.sessions.deriveMessages(sessionId)).toEqual(messagesBefore);
    expect(app.roadmaps.get(project.id)).toEqual(roadmapBefore);
    expect(app.nodes.get(nodeId)).toEqual(nodeBefore);
    expect(app.projects.get(project.id)?.goal).toBe("Complete the approved work plan.");
    expect(eventsBefore.some(event => event.type === "compaction-ended" && event.data.status === "interrupted"))
      .toBe(false);
    await new Promise(resolve => setTimeout(resolve, 25));
    expect(world.requests()).toBe(requestsBefore);

    const resumed = await app.autoRun.start(project.id);

    expect(resumed).toMatchObject({ status: "completed", reason: "roadmap-complete", nodeTurns: 1, mainTurns: 1 });
    expect(messageText(world.taskRequests()[0]!.request)).toContain("PAUSE_CHECKPOINT_SUMMARY");
    expect(app.nodes.get(nodeId)?.status).toBe("completing");
  });

  it.each(["started", "checkpoint"] as const)(
    "restores an interrupted pressure compaction (%s) in a working Node Turn exactly once",
    async variant => {
      const world = await createWorld({
        model: UNBOUNDED,
        tasks: [submitReply(`fixture-submit-${variant}`), ...reviewReplies(`fixture-review-${variant}`, "complete")],
      });
      const fixture = await prepareInterruptedFixture(world, variant);
      let app = await world.open();

      let events = sessionEvents(app, fixture.sessionId);
      assertInterruptedRepair(events, fixture.compactionId, fixture.openTurnId);
      expect(app.nodes.get(fixture.nodeId)?.status).toBe("idle");
      expect(world.requests()).toBe(0);
      expect(events.some(event => event.type === "tool-call-requested")).toBe(false);
      const visible = app.sessions.deriveMessages(fixture.sessionId).map(message => message.id);
      if (variant === "checkpoint") {
        expect(visible).toEqual([fixture.checkpointMessageId, fixture.currentUserId]);
        expect(messagesText(app.sessions.deriveMessages(fixture.sessionId))).toContain(CHECKPOINT_MARKER);
        expect(loggedMessageIds(events)).toEqual(expect.arrayContaining([
          fixture.originalUserId,
          fixture.originalAssistantId,
          fixture.checkpointMessageId,
        ]));
      } else {
        expect(visible).toEqual([
          fixture.originalUserId,
          fixture.originalAssistantId,
          fixture.currentUserId,
        ]);
        expect(messagesText(app.sessions.deriveMessages(fixture.sessionId))).not.toContain("<compacted-summary>");
      }

      app = await world.restart(app);
      events = sessionEvents(app, fixture.sessionId);
      assertInterruptedRepair(events, fixture.compactionId, fixture.openTurnId);
      expect(app.nodes.get(fixture.nodeId)?.status).toBe("idle");
      expect(world.requests()).toBe(0);
      expect(events.some(event => event.type === "tool-call-requested")).toBe(false);

      const result = await app.autoRun.start(fixture.projectId);

      expect(result).toMatchObject({ status: "completed", reason: "roadmap-complete", nodeTurns: 1, mainTurns: 1 });
      expect(world.purposes()).toEqual(["task", "task", "task"]);
      const continued = messageText(world.taskRequests()[0]!.request);
      expect(continued).toContain(CURRENT_TURN_MARKER);
      if (variant === "checkpoint") {
        expect(continued).toContain(CHECKPOINT_MARKER);
        expect(continued).not.toContain(ORIGINAL_HISTORY_MARKER);
      } else {
        expect(continued).toContain(ORIGINAL_HISTORY_MARKER);
        expect(continued).not.toContain("<compacted-summary>");
      }
      assertSurfacePairs(world.taskRequests()[0]!.request.messages);
      expect(app.nodes.get(fixture.nodeId)?.status).toBe("completing");
    },
  );
});
