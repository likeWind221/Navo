import { RpcError } from "../errors.js";
import type { AgentTurnV2Event } from "../content.js";
import { agentTurnV2Method } from "../content/stream.js";
import type { RpcMethod, RpcOutputValidator } from "../protocol.js";
import { exactKeys, requireBoundedString, requireRecord } from "../validation.js";
import type { AutoRunSnapshotV1, AutoRunTargetV1, ProjectRefInput } from "../project.js";
import { parseProjectAutoRunSnapshot, parseProjectRefInput } from "./validation.js";
import { createTurnOutputValidator } from "../content/stream.js";

export const projectAutoRunFollowMethod: RpcMethod<ProjectRefInput, AutoRunFollowEventV1> = Object.freeze({
  name: "project.autorun.follow.v1",
  parseInput: parseProjectRefInput,
  parseOutput: parseAutoRunFollowEvent,
  createOutputValidator: createAutoRunFollowOutputValidator,
});

export type AutoRunFollowEventV1 =
  | { readonly type: "snapshot"; readonly snapshot: AutoRunSnapshotV1 | null }
  | { readonly type: "run-started"; readonly snapshot: AutoRunSnapshotV1 }
  | { readonly type: "target-started"; readonly runId: string; readonly target: AutoRunTargetV1 }
  | { readonly type: "turn-baseline"; readonly runId: string; readonly target: AutoRunTargetV1;
      readonly sessionId: string; readonly turnId: string }
  | { readonly type: "turn-event"; readonly runId: string; readonly target: AutoRunTargetV1; readonly event: AgentTurnV2Event }
  | { readonly type: "pause-requested"; readonly runId: string };

function parseAutoRunFollowEvent(value: unknown): AutoRunFollowEventV1 {
  const event = requireRecord(value, "AutoRun follow event");
  if (event.type === "snapshot" && exactKeys(event, ["type", "snapshot"])) {
    return { type: "snapshot", snapshot: event.snapshot === null ? null : parseProjectAutoRunSnapshot(event.snapshot) };
  }
  if (event.type === "run-started" && exactKeys(event, ["type", "snapshot"])) {
    return { type: "run-started", snapshot: parseProjectAutoRunSnapshot(event.snapshot) };
  }
  if (event.type === "target-started" && exactKeys(event, ["type", "runId", "target"])) {
    return { type: "target-started", runId: id(event.runId, "runId"), target: parseTarget(event.target) };
  }
  if (event.type === "turn-baseline" && exactKeys(event, ["type", "runId", "target", "sessionId", "turnId"])) {
    return { type: "turn-baseline", runId: id(event.runId, "runId"), target: parseTarget(event.target),
      sessionId: id(event.sessionId, "sessionId"), turnId: id(event.turnId, "turnId") };
  }
  if (event.type === "turn-event" && exactKeys(event, ["type", "runId", "target", "event"])) {
    return { type: "turn-event", runId: id(event.runId, "runId"), target: parseTarget(event.target),
      event: agentTurnV2Method.parseOutput(event.event) };
  }
  if (event.type === "pause-requested" && exactKeys(event, ["type", "runId"])) {
    return { type: "pause-requested", runId: id(event.runId, "runId") };
  }
  throw new RpcError("invalid-output", "Unknown or malformed AutoRun follow event");
}

function parseTarget(value: unknown): AutoRunTargetV1 {
  const target = requireRecord(value, "AutoRun target");
  if (target.kind === "main" && exactKeys(target, ["kind"])) return { kind: "main" };
  if (target.kind === "node" && exactKeys(target, ["kind", "nodeId"])) {
    return { kind: "node", nodeId: id(target.nodeId, "nodeId") };
  }
  throw new RpcError("invalid-output", "Malformed AutoRun target");
}

function createAutoRunFollowOutputValidator(input: ProjectRefInput): RpcOutputValidator<AutoRunFollowEventV1> {
  let received = false;
  let runId: string | undefined;
  let status: AutoRunSnapshotV1["status"] | undefined;
  let activeTarget: AutoRunTargetV1 | undefined;
  let activeTurn: ReturnType<typeof createTurnOutputValidator> | undefined;
  let partialTurn: { readonly runId: string; readonly target: AutoRunTargetV1; readonly sessionId: string;
    readonly turnId: string; readonly requestId?: string } | undefined;
  return {
    parse(value) {
      const event = parseAutoRunFollowEvent(value);
      const first = !received;
      if (first) {
        if (event.type !== "snapshot") invalid("AutoRun follow must start with a snapshot");
        received = true;
      }
      if (event.type === "snapshot") {
        if (event.snapshot === null && !first) invalid("AutoRun null snapshot is only valid as the baseline");
        if (event.snapshot !== null) {
          if (event.snapshot.projectId !== input.projectId) invalid("AutoRun snapshot project mismatch");
          if (runId !== undefined && runId !== event.snapshot.runId) invalid("AutoRun snapshot identity changed without a new run");
          if (status !== undefined && status !== event.snapshot.status
            && (status !== "running" || event.snapshot.status === "running")) {
            invalid("AutoRun snapshot status changed without a run transition");
          }
          const nextTarget = event.snapshot.currentTarget ?? undefined;
          if ((activeTurn !== undefined || partialTurn !== undefined)
            && !sameTargetOrNone(activeTarget, nextTarget)) {
            invalid("AutoRun snapshot changed target during a turn");
          }
          if (status === "running" && !sameTargetOrNone(activeTarget, nextTarget)) {
            invalid("AutoRun snapshot changed target without a target event");
          }
          if (event.snapshot.status !== "running" && (activeTurn !== undefined || partialTurn !== undefined)) {
            invalid("AutoRun snapshot ended a turn before its terminal event");
          }
          runId ??= event.snapshot.runId;
          status = event.snapshot.status;
          activeTarget = nextTarget;
        }
        return event;
      }
      if (event.type === "run-started") {
        if (event.snapshot.projectId !== input.projectId || event.snapshot.status !== "running"
          || status === "running" || activeTurn !== undefined || partialTurn !== undefined
          || runId === event.snapshot.runId) invalid("AutoRun run-started order is invalid");
        runId = event.snapshot.runId;
        status = event.snapshot.status;
        activeTarget = event.snapshot.currentTarget ?? undefined;
        return event;
      }
      if (runId === undefined || event.runId !== runId) invalid("AutoRun event identity mismatch");
      if (event.type === "target-started") {
        if (status !== "running" || activeTurn !== undefined || partialTurn !== undefined) {
          invalid("AutoRun target changed outside a running boundary");
        }
        activeTarget = event.target;
        return event;
      }
      if (event.type === "pause-requested") {
        if (status !== "running") invalid("AutoRun pause order is invalid");
        return event;
      }
      if (event.type === "turn-baseline") {
        if (status !== "running" || activeTurn !== undefined || partialTurn !== undefined) {
          invalid("AutoRun turn baseline is outside a running boundary");
        }
        if (!sameTarget(activeTarget, event.target)) invalid("AutoRun turn baseline target mismatch");
        partialTurn = event;
        activeTarget = event.target;
        return event;
      }
      if (status !== "running" || !sameTarget(activeTarget, event.target)) invalid("AutoRun turn target mismatch");
      if (event.event.type === "turn-started") {
        if (activeTurn !== undefined || partialTurn !== undefined) invalid("Duplicate AutoRun turn start");
        activeTurn = createTurnOutputValidator({ sessionId: event.event.sessionId, requestId: event.event.requestId, text: "" });
        activeTurn.parse(event.event);
      } else if (activeTurn !== undefined) {
        activeTurn.parse(event.event);
      } else if (partialTurn === undefined || partialTurn.sessionId !== event.event.sessionId || partialTurn.turnId !== event.event.turnId) {
        invalid("AutoRun turn event has no active or late baseline");
      } else if (partialTurn.requestId !== undefined && partialTurn.requestId !== event.event.requestId) {
        invalid("AutoRun late turn request identity mismatch");
      } else {
        partialTurn = { ...partialTurn, requestId: event.event.requestId };
      }
      if (isTerminal(event.event)) {
        activeTurn?.end();
        activeTurn = undefined;
        partialTurn = undefined;
      }
      return event;
    },
    end() {
      if (!received) invalid("AutoRun follow ended before its baseline");
    },
  };
}

function sameTarget(left: AutoRunTargetV1 | undefined, right: AutoRunTargetV1): boolean {
  return left?.kind === right.kind && (left.kind === "main" || (right.kind === "node" && left.nodeId === right.nodeId));
}

function sameTargetOrNone(left: AutoRunTargetV1 | undefined, right: AutoRunTargetV1 | undefined): boolean {
  return left === undefined ? right === undefined : right !== undefined && sameTarget(left, right);
}

function isTerminal(event: AgentTurnV2Event): boolean {
  return event.type === "turn-completed" || event.type === "turn-cancelled"
    || event.type === "turn-failed" || event.type === "turn-truncated";
}

function id(value: unknown, label: string): string {
  return requireBoundedString(value, label, 128);
}

function invalid(message: string): never {
  throw new RpcError("invalid-output", message);
}
