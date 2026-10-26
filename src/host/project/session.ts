import type { Context } from "cordis";

import { RpcError } from "../../../rpc/errors.js";
import type {
  ProjectSessionOwnerV1,
  ProjectSessionRecoveryV1,
  ProjectSessionRecoveryEntryV1,
  ProjectSessionTurnV1,
} from "../../../rpc/project/session.js";
import type { ProjectRefInput } from "../../../rpc/project.js";
import type { RpcStreamHandler } from "../../../rpc/stream.js";
import type { SessionId, TurnId } from "../../brand/ids.js";
import type { SessionEvent } from "../../session/types.js";
import { requireProject } from "./view.js";
import { toProjectFailure } from "./failure.js";

export function createProjectSessionRecoveryHandler(
  ctx: Context,
): RpcStreamHandler<ProjectRefInput, ProjectSessionRecoveryV1> {
  return async function* projectSessionRecovery(input, signal) {
    signal.throwIfAborted();
    try {
      const project = requireProject(ctx, input.projectId);
      const sessions: ProjectSessionRecoveryEntryV1[] = [
        describeSession(ctx, signal, { kind: "main" }, project.mainSessionId),
      ];
      for (const node of ctx.nodes.getByProject(project.id)) {
        signal.throwIfAborted();
        const owner: ProjectSessionOwnerV1 = { kind: "node", nodeId: node.node.id };
        sessions.push(node.sessionId === undefined
          ? { owner, status: "unestablished" }
          : describeSession(ctx, signal, owner, node.sessionId));
      }
      yield { projectId: project.id, sessions };
    } catch (error: unknown) {
      if (error instanceof RpcError) throw error;
      throw toProjectFailure(error);
    }
  };
}

function describeSession(
  ctx: Context,
  signal: AbortSignal,
  owner: ProjectSessionOwnerV1,
  sessionId: SessionId,
): ProjectSessionRecoveryEntryV1 {
  signal.throwIfAborted();
  const id = String(sessionId);
  if (ctx.storage.recovery.unavailableSessionIds.has(id)) {
    return { owner, status: "unavailable", sessionId: id, reason: "not-readable" };
  }
  return { owner, status: "available", sessionId: id, lastEndedTurn: lastEndedTurn(ctx.sessions.getEvents(sessionId)) };
}

function lastEndedTurn(events: readonly SessionEvent[]): ProjectSessionTurnV1 | null {
  for (let end = events.length - 1; end >= 0; end -= 1) {
    const ended = events[end]!;
    if (ended.type !== "turn-ended") continue;
    const started = findTurnStart(events, end, ended.data.turnId);
    if (started === undefined) throw new Error("Persisted Turn ended without a matching start event.");
    const interruption = findInterruption(events, end, ended.data.turnId);
    return {
      turnId: String(ended.data.turnId),
      status: ended.data.status,
      startedAt: started.timestamp,
      endedAt: ended.timestamp,
      interruption,
    };
  }
  return null;
}

function findTurnStart(events: readonly SessionEvent[], end: number, turnId: TurnId) {
  for (let index = end - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === "turn-started" && event.data.turnId === turnId) return event;
  }
  return undefined;
}

function findInterruption(events: readonly SessionEvent[], end: number, turnId: string): ProjectSessionTurnV1["interruption"] {
  let hostStopped = false;
  for (let index = end - 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type === "turn-started") {
      if (String(event.data.turnId) !== turnId) return hostStopped ? "host-stopped" : null;
      return hostStopped ? "host-stopped" : null;
    }
    if (event.type === "compaction-ended" && String(event.data.turnId) === turnId
      && event.data.status === "interrupted" && event.data.failure?.code === "context-compaction-interrupted") {
      return "context-compaction";
    }
    if (event.type !== "error" || String(event.data.turnId) !== turnId) continue;
    if (event.data.failure.code === "interrupted") hostStopped = true;
  }
  return hostStopped ? "host-stopped" : null;
}
