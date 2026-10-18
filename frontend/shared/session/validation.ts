import type { SessionFailureCode } from "../../../rpc/session.js";
import { parseSessionContextFollowEvent } from "../../../rpc/session/validation.js";
import type { JsonValue } from "../../../rpc/protocol.js";
import {
  exactKeys,
  isJsonValue,
  requireBoundedString,
  requireRecord,
} from "../../../rpc/validation.js";
import type {
  DesktopSessionEvent,
  DesktopSessionFailure,
  DesktopSessionFailureCode,
  DesktopSessionFollowHandle,
  DesktopSessionResult,
} from "../session.js";

export const DESKTOP_SESSION_FAILURE_MESSAGE_MAX_CHARS = 2_048;
const SUBSCRIPTION_ID_MAX = 128;

const SESSION_FAILURE_CODES: readonly SessionFailureCode[] = [
  "session-context-unavailable",
  "history-changed",
  "internal",
];

const BRIDGE_FAILURE_CODES: readonly DesktopSessionFailureCode[] = [
  "invalid-input",
  "invalid-output",
  "host-unavailable",
  "bridge-closed",
];

export function parseDesktopSessionResult<T>(
  value: unknown,
  parseValue: (value: unknown) => T,
): DesktopSessionResult<T> {
  const result = requireRecord(value, "desktop session result");
  if (result.type === "ok" && exactKeys(result, ["type", "value"])) {
    return { type: "ok", value: parseValue(result.value) };
  }
  if (result.type === "failed" && exactKeys(result, ["type", "failure"])) {
    return { type: "failed", failure: parseDesktopSessionFailure(result.failure) };
  }
  throw new Error("Malformed desktop session result");
}

export function parseDesktopSessionFollowHandle(value: unknown): DesktopSessionFollowHandle {
  const handle = requireRecord(value, "desktop session follow handle");
  if (!exactKeys(handle, ["subscriptionId"])) throw new Error("Malformed desktop session follow handle");
  return { subscriptionId: parseDesktopSubscriptionId(handle.subscriptionId) };
}

export function parseDesktopSessionEvent(value: unknown): DesktopSessionEvent {
  const update = requireRecord(value, "desktop session event");
  if (update.type === "context-event" && exactKeys(update, ["type", "subscriptionId", "event"])) {
    return {
      type: "context-event",
      subscriptionId: parseDesktopSubscriptionId(update.subscriptionId),
      event: parseSessionContextFollowEvent(update.event),
    };
  }
  if (update.type === "context-follow-error"
    && exactKeys(update, ["type", "subscriptionId", "failure"])) {
    return {
      type: "context-follow-error",
      subscriptionId: parseDesktopSubscriptionId(update.subscriptionId),
      failure: parseDesktopSessionFailure(update.failure),
    };
  }
  throw new Error("Malformed desktop session event");
}

export function parseDesktopSubscriptionId(value: unknown): string {
  return requireBoundedString(value, "subscriptionId", SUBSCRIPTION_ID_MAX);
}

export function isSessionFailureCode(value: unknown): value is SessionFailureCode {
  return (SESSION_FAILURE_CODES as readonly unknown[]).includes(value);
}

export function parseDesktopSessionNull(value: unknown): null {
  if (value !== null) throw new Error("Malformed desktop session null result");
  return null;
}

function parseDesktopSessionFailure(value: unknown): DesktopSessionFailure {
  const failure = requireRecord(value, "desktop session failure");
  const keys = Reflect.ownKeys(failure);
  if (keys.some(key => key !== "code" && key !== "message" && key !== "details")
    || !Object.hasOwn(failure, "code") || !Object.hasOwn(failure, "message")) {
    throw new Error("Malformed desktop session failure");
  }
  const details = failure.details === undefined ? undefined : parseDetails(failure.details);
  return {
    code: parseFailureCode(failure.code),
    message: requireBoundedString(
      failure.message,
      "failure message",
      DESKTOP_SESSION_FAILURE_MESSAGE_MAX_CHARS,
    ),
    ...(details === undefined ? {} : { details }),
  };
}

function parseDetails(value: unknown): Readonly<Record<string, JsonValue>> {
  const details = requireRecord(value, "desktop session failure details");
  if (!isJsonValue(details)) throw new Error("Malformed desktop session failure details");
  return details as Readonly<Record<string, JsonValue>>;
}

function parseFailureCode(value: unknown): DesktopSessionFailureCode {
  if (isSessionFailureCode(value) || (BRIDGE_FAILURE_CODES as readonly unknown[]).includes(value)) {
    return value as DesktopSessionFailureCode;
  }
  throw new Error("Unknown desktop session failure code");
}
