import { exactKeys, requireBoundedString, requireRecord } from "../../../rpc/validation.js";
import { parseAgentTurnEvent } from "../../../rpc/agent.js";
import type { DesktopAgentCommandResult, DesktopAgentTurnUpdate, DesktopAgentFailure } from "../agent.js";

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
