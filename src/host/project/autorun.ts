import type { Context } from "cordis";
import type { AutoRunFollowEventV1 } from "../../../rpc/project/autorun.js";
import type { AgentTurnV2Event } from "../../../rpc/content.js";
import type { AutoRunSnapshotV1 } from "../../../rpc/project.js";
import type { ProjectRefInput } from "../../../rpc/project.js";
import type { RpcStreamHandler } from "../../../rpc/stream.js";
import type { AutoRunSnapshot } from "../../project/autorun.js";
import { StreamEventQueue } from "../turn/queue.js";
import { toProjectFailure } from "./failure.js";
import { requireProject } from "./view.js";

export function createProjectAutoRunFollowHandler(
  ctx: Context,
): RpcStreamHandler<ProjectRefInput, AutoRunFollowEventV1> {
  return async function* (input, signal) {
    if (signal.aborted) return;
    const projectId = requireProject(ctx, input.projectId).id;
    const frames = new StreamEventQueue<AutoRunFollowEventV1>();
    const dispose = ctx.autoRun.observe(projectId, event => {
      if (event.type === "closed") {
        frames.end();
        return;
      }
      if (event.type === "turn-event") {
        if (!isPublicTurnEvent(event.event)) return;
        frames.push(toFollowEvent({ ...event, event: event.event }));
      } else {
        frames.push(toFollowEvent(event));
      }
    });
    const stop = (): void => {
      dispose();
      frames.end();
    };
    signal.addEventListener("abort", stop, { once: true });
    try {
      for await (const frame of frames) yield frame;
    } catch (error: unknown) {
      throw toProjectFailure(error);
    } finally {
      signal.removeEventListener("abort", stop);
      dispose();
    }
  };
}

function isPublicTurnEvent(event: import("../../agent/types.js").TurnEvent): event is import("../../../rpc/content.js").AgentTurnV2Event {
  return !("commandId" in event);
}

function toFollowEvent(event: import("../../project/autorun/observation.js").AutoRunObservationEvent): AutoRunFollowEventV1 {
  if (event.type === "snapshot") return { type: "snapshot", snapshot: event.snapshot === null ? null : describe(event.snapshot) };
  if (event.type === "run-started") return { type: "run-started", snapshot: describe(event.snapshot) };
  if (event.type === "target-started") return { type: "target-started", runId: event.runId, target: { ...event.target } };
  if (event.type === "turn-baseline") return { type: "turn-baseline", runId: event.turn.runId, target: { ...event.turn.target },
    sessionId: event.turn.sessionId, turnId: event.turn.turnId };
  if (event.type === "pause-requested") return { type: "pause-requested", runId: event.runId };
  if (event.type === "turn-event") return { type: "turn-event", runId: event.runId, target: { ...event.target }, event: event.event as AgentTurnV2Event };
  throw new Error("AutoRun observer closed without an end frame.");
}

function describe(snapshot: AutoRunSnapshot): AutoRunSnapshotV1 {
  return {
    runId: snapshot.runId,
    projectId: snapshot.projectId,
    status: snapshot.status,
    nodeTurns: snapshot.nodeTurns,
    mainTurns: snapshot.mainTurns,
    currentTarget: snapshot.currentTarget === null ? null : { ...snapshot.currentTarget },
    reason: snapshot.reason,
  };
}
