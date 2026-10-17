import { createEventId, createNodeId, createSessionId } from "../brand/ids.js";
import type { NodeEvent } from "../node/events.js";
import { immutable, projectNode } from "../node/projector.js";
import { interruptedTurnClosers } from "../session/repair.js";
import { parseSessionEvent } from "../session/history.js";
import type { SessionEvent } from "../session/types.js";
import type { StorageTransaction, StoredHistory } from "./database.js";
import type { RecoveryPlan } from "./recovery.js";

export interface InterruptionRepair {
  commit(tx: StorageTransaction): RecoveryPlan;
}

function interruptedCompactionClosers(
  sessionId: ReturnType<typeof createSessionId>,
  events: readonly SessionEvent[],
): readonly SessionEvent[] {
  const started = new Map<string, Extract<SessionEvent, { readonly type: "compaction-started" }>>();
  const ended = new Set<string>();
  for (const event of events) {
    if (event.type === "compaction-started") started.set(event.data.compactionId, event);
    if (event.type === "compaction-ended") ended.add(event.data.compactionId);
  }
  const closers: SessionEvent[] = [];
  for (const [compactionId, event] of started) {
    if (ended.has(compactionId)) continue;
    const sequence = events.length + closers.length + 1;
    closers.push(parseSessionEvent(sessionId, {
      id: createEventId(`recovery:compaction:${sessionId}:${compactionId}`),
      sessionId,
      sequence,
      timestamp: event.timestamp,
      type: "compaction-ended",
      data: {
        turnId: event.data.turnId,
        compactionId,
        status: "interrupted",
        failure: {
          code: "context-compaction-interrupted",
          message: "Compaction was interrupted because the Host stopped before it recorded completion.",
        },
      },
    }, sequence));
  }
  return Object.freeze(closers);
}

export function planInterruptionRepair(plan: RecoveryPlan): InterruptionRepair | undefined {
  const sessionChanges = new Map<string, StoredHistory<string | null>>();
  for (const [sessionId, history] of plan.sessions) {
    const sessionKey = createSessionId(sessionId);
    const existing = history.events as readonly SessionEvent[];
    const compactionClosers = interruptedCompactionClosers(sessionKey, existing);
    const turnClosers = interruptedTurnClosers(sessionKey, [...existing, ...compactionClosers]);
    const closers = [...compactionClosers, ...turnClosers];
    if (closers.length > 0) {
      sessionChanges.set(sessionId, {
        projectId: history.projectId,
        events: Object.freeze([...existing, ...closers]),
      });
    }
  }

  const nodeChanges = new Map<string, StoredHistory>();
  for (const [nodeId, history] of plan.events.get("node")!) {
    const events = history.events as readonly NodeEvent[];
    const snapshot = projectNode(createNodeId(nodeId), events);
    if (snapshot?.status !== "working") continue;
    const sessionTimestamp = snapshot.sessionId === undefined
      ? undefined
      : (sessionChanges.get(snapshot.sessionId)?.events.at(-1) as SessionEvent | undefined)?.timestamp
        ?? (plan.sessions.get(snapshot.sessionId)?.events.at(-1) as SessionEvent | undefined)?.timestamp;
    const timestamp = sessionTimestamp ?? events.at(-1)!.timestamp;
    const workEnded: NodeEvent = immutable({
      version: 2,
      id: createEventId(`recovery:${nodeId}:${events.length + 1}`),
      nodeId: createNodeId(nodeId),
      revision: events.length + 1,
      timestamp,
      type: "work-ended",
      data: {},
    }) as NodeEvent;
    projectNode(createNodeId(nodeId), [...events, workEnded]);
    nodeChanges.set(nodeId, {
      projectId: history.projectId,
      events: Object.freeze([...events, workEnded]),
    });
  }

  if (sessionChanges.size === 0 && nodeChanges.size === 0) return undefined;
  return {
    commit(tx) {
      for (const [sessionId, history] of sessionChanges) {
        const previous = plan.sessions.get(sessionId)!;
        tx.appendEvents({
          domain: "session",
          ownerId: sessionId,
          projectId: history.projectId,
          firstSeq: previous.events.length + 1,
          events: history.events.slice(previous.events.length),
        });
      }
      for (const [nodeId, history] of nodeChanges) {
        const previous = plan.events.get("node")!.get(nodeId)!;
        tx.appendEvents({
          domain: "node",
          ownerId: nodeId,
          projectId: history.projectId,
          firstSeq: previous.events.length + 1,
          events: history.events.slice(previous.events.length),
        });
      }
      const sessions = new Map(plan.sessions);
      for (const [sessionId, history] of sessionChanges) sessions.set(sessionId, history);
      const nodes = new Map(plan.events.get("node")!);
      for (const [nodeId, history] of nodeChanges) nodes.set(nodeId, history);
      const events = new Map(plan.events);
      events.set("node", nodes);
      return Object.freeze({ ...plan, sessions, events });
    },
  };
}
