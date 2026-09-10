import { exactKeys, requireBoundedString, requireRecord } from "../../../rpc/validation.js";
import { parseAgentTurnEvent } from "../../../rpc/agent.js";
import { parseCommandEvent, parseTurnEvent } from "../../../rpc/content/validation.js";
import type {
  DesktopAgentCommandResult,
  DesktopAgentEvent,
  DesktopAgentFailure,
  DesktopAgentTurnUpdate,
} from "../agent.js";

export function parseDesktopAgentCommandResult(value: unknown): DesktopAgentCommandResult {
  const result = requireRecord(value, "desktop agent command result");
  if (result.type === "accepted" && exactKeys(result, ["type"])) return { type: "accepted" };
  if (result.type === "rejected" && exactKeys(result, ["type", "failure"])) {
    return { type: "rejected", failure: parseDesktopAgentFailure(result.failure) };
  }
  throw new Error("Malformed desktop agent command result");
}

export function parseDesktopAgentTurnUpdate(value: unknown): DesktopAgentTurnUpdate {
  const update = requireRecord(value, "desktop agent turn update");
  const requestId = parseDesktopRequestId(update.requestId);
  if (update.type === "event" && exactKeys(update, ["type", "requestId", "event"])) {
    return { type: "event", requestId, event: parseAgentTurnEvent(update.event) };
  }
  if (update.type === "bridge-error" && exactKeys(update, ["type", "requestId", "failure"])) {
    const failure = parseDesktopAgentFailure(update.failure);
    return {
      type: "bridge-error",
      requestId,
      failure,
    };
  }
  throw new Error("Malformed desktop agent turn update");
}

export function parseDesktopAgentEvent(value: unknown): DesktopAgentEvent {
  const update = requireRecord(value, "desktop agent event");
  if (update.type === "turn-event" && exactKeys(update, ["type", "event"])) {
    const event = parseAgentTurnV2Event(update.event);
    return { type: "turn-event", event };
  }
  if (update.type === "command-event" && exactKeys(update, ["type", "event"])) {
    return { type: "command-event", event: parseCommandEvent(update.event) };
  }
  if (update.type === "turn-error" && exactKeys(update, ["type", "requestId", "failure"])) {
    return {
      type: "turn-error",
      requestId: parseDesktopRequestId(update.requestId),
      failure: parseDesktopAgentFailure(update.failure),
    };
  }
  if (update.type === "command-error" && exactKeys(update, ["type", "commandId", "name", "failure"])) {
    const name = requireBoundedString(update.name, "command name", 64);
    if (!/^[a-z][a-z0-9-]*$/.test(name)) throw new Error("Malformed desktop command error");
    return {
      type: "command-error",
      commandId: parseDesktopRequestId(update.commandId),
      name,
      failure: parseDesktopAgentFailure(update.failure),
    };
  }
  return parseDesktopAgentTurnUpdate(value);
}

function parseAgentTurnV2Event(value: unknown) {
  const event = parseTurnEvent(value);
  if ("commandId" in event) throw new Error("Command event is not a turn event");
  return event;
}

function parseDesktopAgentFailure(value: unknown): DesktopAgentFailure {
  const failure = requireRecord(value, "desktop agent failure");
  if (!exactKeys(failure, ["code", "message"])) throw new Error("Malformed desktop agent failure");
  return {
    code: requireBoundedString(failure.code, "failure code", 128),
    message: requireBoundedString(failure.message, "failure message", 2_048),
  };
}

export function parseDesktopRequestId(value: unknown): string {
  return requireBoundedString(value, "requestId", 128);
}
