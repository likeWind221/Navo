import {
  createMessageId,
  createSessionId,
  createStepId,
  createTurnId,
} from "../../../src/brand/ids.js";
import {
  SUMMARY_CLOSE_TAG,
  SUMMARY_OPEN_TAG,
} from "../../../src/context/compaction/summarizer.js";
import { createProject } from "./helpers.js";
import type { World } from "./helpers.js";

export const ORIGINAL_HISTORY_MARKER = "ORIGINAL_HISTORY_MARKER: required evidence";
export const CURRENT_TURN_MARKER = "CURRENT_TURN_MARKER: finish this Node";
export const CHECKPOINT_MARKER = "FIXTURE_CHECKPOINT_MARKER: preserved context";

export type InterruptedVariant = "started" | "checkpoint";

export async function prepareInterruptedFixture(world: World, variant: InterruptedVariant) {
  const app = await world.open();
  const { project, nodeIds } = await createProject(app, world.workspaceRoot, ["Fixture Node"]);
  const nodeId = nodeIds[0]!;
  const sessionId = createSessionId(`fixture-session-${variant}`);
  app.nodes.bindSession(nodeId, sessionId);

  const originalUserId = createMessageId(`fixture-original-user-${variant}`);
  const originalAssistantId = createMessageId(`fixture-original-assistant-${variant}`);
  const currentUserId = createMessageId(`fixture-current-user-${variant}`);
  const checkpointMessageId = createMessageId(`fixture-checkpoint-${variant}`);
  const priorTurnId = createTurnId(`fixture-prior-turn-${variant}`);
  const priorStepId = createStepId(`fixture-prior-step-${variant}`);
  const openTurnId = createTurnId(`fixture-open-turn-${variant}`);
  const openStepId = createStepId(`fixture-open-step-${variant}`);
  const compactionId = `fixture-compaction-${variant}`;

  app.sessions.append({ type: "turn-started", sessionId, data: { turnId: priorTurnId } });
  app.sessions.append({
    type: "user-message",
    sessionId,
    data: { message: {
      id: originalUserId,
      role: "user",
      content: [{ type: "text", text: ORIGINAL_HISTORY_MARKER }],
    } },
  });
  app.sessions.append({
    type: "step-started",
    sessionId,
    data: { turnId: priorTurnId, stepId: priorStepId },
  });
  app.sessions.append({
    type: "assistant-message",
    sessionId,
    data: {
      turnId: priorTurnId,
      stepId: priorStepId,
      message: {
        id: originalAssistantId,
        role: "assistant",
        content: [{ type: "text", text: `${ORIGINAL_HISTORY_MARKER} acknowledged` }],
      },
      finishReason: { kind: "stop" },
    },
  });
  app.sessions.append({
    type: "step-ended",
    sessionId,
    data: { turnId: priorTurnId, stepId: priorStepId, status: "completed" },
  });
  app.sessions.append({ type: "turn-ended", sessionId, data: { turnId: priorTurnId, status: "completed" } });

  app.nodes.beginWork(nodeId);
  app.sessions.append({ type: "turn-started", sessionId, data: { turnId: openTurnId } });
  app.sessions.append({
    type: "user-message",
    sessionId,
    data: { message: {
      id: currentUserId,
      role: "user",
      content: [{ type: "text", text: CURRENT_TURN_MARKER }],
    } },
  });
  app.sessions.append({
    type: "step-started",
    sessionId,
    data: { turnId: openTurnId, stepId: openStepId },
  });

  const surface = app.sessions.getSurfaceSnapshot(sessionId);
  const coveredStart = surface.sequences[0]!;
  const coveredEnd = surface.sequences[1]!;
  app.sessions.append({
    type: "compaction-started",
    sessionId,
    data: {
      turnId: openTurnId,
      compactionId,
      trigger: "pressure",
      coveredStart,
      coveredEnd,
    },
  });
  if (variant === "checkpoint") {
    app.sessions.appendCompactionCheckpoint({
      type: "compaction-checkpoint",
      sessionId,
      data: {
        turnId: openTurnId,
        compactionId,
        message: {
          id: checkpointMessageId,
          role: "user",
          content: [{
            type: "text",
            text: `${SUMMARY_OPEN_TAG}\n${CHECKPOINT_MARKER}\n${SUMMARY_CLOSE_TAG}`,
          }],
        },
        coveredStart,
        coveredEnd,
        summaryVersion: 1,
      },
    }, surface, coveredStart, coveredEnd);
  }
  await world.close(app);
  return {
    projectId: project.id,
    nodeId,
    sessionId,
    compactionId,
    openTurnId,
    originalUserId,
    originalAssistantId,
    currentUserId,
    checkpointMessageId,
  };
}
