import type { Context } from "cordis";

import type { NodeId, ProjectId } from "../../src/brand/ids.js";
import { MIN_PRESSURE_COMPACTIONS } from "./config.js";

export interface PauseWatch {
  readonly completed: number;
  readonly pauseError: string | null;
  dispose(): void;
}

export function watchSecondCompaction(app: Context, projectId: ProjectId, nodeAId: NodeId): PauseWatch {
  const counted = new Set<string>();
  let requested = false;
  let pauseError: string | null = null;
  const scan = (): void => {
    const sessionId = app.nodes.get(nodeAId)?.sessionId;
    if (sessionId === undefined) return;
    const events = app.sessions.getEvents(sessionId);
    const triggers = new Map<string, string>();
    for (const event of events) {
      if (event.type === "compaction-started") {
        triggers.set(event.data.compactionId, event.data.trigger);
      }
    }
    for (const event of events) {
      if (event.type !== "compaction-ended" || event.data.status !== "completed") continue;
      if (triggers.get(event.data.compactionId) !== "pressure") continue;
      counted.add(event.data.compactionId);
    }
    if (counted.size < MIN_PRESSURE_COMPACTIONS || requested) return;
    if (app.nodes.get(nodeAId)?.status !== "submitted") return;
    requested = true;
    try {
      app.autoRun.pause(projectId);
    } catch (error: unknown) {
      pauseError = error instanceof Error ? error.message : String(error);
    }
  };
  const disposeSession = app.on("session/event", (event) => {
    const sessionId = app.nodes.get(nodeAId)?.sessionId;
    if (sessionId !== undefined && event.sessionId === sessionId) scan();
  });
  const disposeNode = app.on("node/event", (event) => {
    if (event.nodeId === nodeAId) scan();
  });
  scan();
  return {
    get completed() {
      return counted.size;
    },
    get pauseError() {
      return pauseError;
    },
    dispose() {
      disposeSession();
      disposeNode();
    },
  };
}
