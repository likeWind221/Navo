import type { Context } from "cordis";

import type {
  SessionCompactionEventV1,
  SessionContextFollowEventV1,
  SessionContextFollowInputV1,
  SessionContextSnapshotV1,
} from "../../../rpc/session.js";
import type { RpcStreamHandler } from "../../../rpc/stream.js";
import { createSessionId } from "../../brand/ids.js";
import type { SessionEvent } from "../../session/types.js";
import { eventMessage } from "../../session/surface.js";
import { StreamEventQueue } from "../turn/queue.js";
import { toSessionFailure } from "./failure.js";
import { createSessionContextSnapshot } from "./snapshot.js";

const FAILURE_MESSAGE_MAX_CHARS = 4_096;

export function createSessionContextFollowHandler(
  ctx: Context,
): RpcStreamHandler<SessionContextFollowInputV1, SessionContextFollowEventV1> {
  return async function* sessionContextFollow(input, signal) {
    const sessionId = createSessionId(input.sessionId);
    const frames = new StreamEventQueue<SessionContextFollowEventV1>();
    let processed = 0;
    let generation = 0;
    let initialized = false;
    let lastContextKey: string | undefined;

    const stop = (): void => frames.end();

    const emitSnapshot = (type: "snapshot" | "context-updated"): void => {
      const snapshot = createSessionContextSnapshot(ctx, sessionId);
      const key = snapshotKey(snapshot);
      if (type === "context-updated" && key === lastContextKey) return;
      lastContextKey = key;
      frames.push({ type, snapshot });
    };

    const apply = (event: SessionEvent): void => {
      switch (event.type) {
        case "compaction-started":
          frames.push({ type: "compaction-event", event: {
            kind: "started",
            sessionId,
            sequence: event.sequence,
            timestamp: event.timestamp,
            compactionId: event.data.compactionId,
            trigger: event.data.trigger,
            coveredStart: event.data.coveredStart,
            coveredEnd: event.data.coveredEnd,
            ...(event.data.turnId === undefined ? {} : { turnId: event.data.turnId }),
          } });
          return;
        case "compaction-checkpoint":
          generation += 1;
          frames.push({ type: "compaction-event", event: {
            kind: "checkpoint",
            sessionId,
            sequence: event.sequence,
            timestamp: event.timestamp,
            compactionId: event.data.compactionId,
            coveredStart: event.data.coveredStart,
            coveredEnd: event.data.coveredEnd,
            summaryVersion: event.data.summaryVersion,
            surfaceGeneration: generation,
          } });
          emitSnapshot("context-updated");
          return;
        case "compaction-ended":
          frames.push({ type: "compaction-event", event: {
            kind: "ended",
            sessionId,
            sequence: event.sequence,
            timestamp: event.timestamp,
            compactionId: event.data.compactionId,
            status: event.data.status,
            ...(event.data.beforeTokens === undefined ? {} : { beforeTokens: event.data.beforeTokens }),
            ...(event.data.afterTokens === undefined ? {} : { afterTokens: event.data.afterTokens }),
            ...(event.data.summaryTokens === undefined ? {} : { summaryTokens: event.data.summaryTokens }),
            ...(event.data.provider === undefined ? {} : { provider: event.data.provider }),
            ...(event.data.model === undefined ? {} : { model: event.data.model }),
            ...(event.data.failure === undefined ? {} : { failure: {
              code: event.data.failure.code,
              message: bounded(event.data.failure.message),
            } }),
          } });
          return;
        case "user-message":
        case "tool-call-result":
          emitSnapshot("context-updated");
          return;
        case "assistant-message":
          if (eventMessage(event) !== undefined) emitSnapshot("context-updated");
          return;
        default:
          return;
      }
    };

    const drain = (): void => {
      if (!initialized) return;
      try {
        const events = ctx.sessions.getEvents(sessionId);
        while (processed < events.length) {
          const event = events[processed]!;
          processed += 1;
          apply(event);
        }
      } catch (error: unknown) {
        frames.fail(toSessionFailure(error));
      }
    };

    const dispose = ctx.on("session/event", event => {
      if (event.sessionId !== sessionId) return;
      drain();
    });
    signal.addEventListener("abort", stop, { once: true });
    if (signal.aborted) stop();

    try {
      const snapshot = createSessionContextSnapshot(ctx, sessionId);
      processed = snapshot.eventSequence;
      generation = snapshot.surfaceGeneration;
      lastContextKey = snapshotKey(snapshot);
      frames.push({ type: "snapshot", snapshot });
      initialized = true;
      drain();
      for await (const frame of frames) yield frame;
    } catch (error: unknown) {
      frames.fail(toSessionFailure(error));
      for await (const frame of frames) yield frame;
    } finally {
      signal.removeEventListener("abort", stop);
      dispose();
    }
  };
}

function snapshotKey(snapshot: SessionContextSnapshotV1): string {
  return [
    snapshot.eventSequence,
    snapshot.surfaceGeneration,
    snapshot.measurement.usedTokens,
    snapshot.measurement.estimatedRequestTokens,
    snapshot.measurement.basis,
  ].join(":");
}

function bounded(message: string): string {
  return message.length > FAILURE_MESSAGE_MAX_CHARS
    ? message.slice(0, FAILURE_MESSAGE_MAX_CHARS)
    : message;
}
