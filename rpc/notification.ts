import type { DisplayFailure } from "./failure.js";
import { DISPLAY_SUMMARY_MAX_CHARS } from "./failure.js";
import { parseDisplayFailure } from "./failure.js";
import { RpcError } from "./errors.js";
import { exactKeys, requireBoundedString, requireRecord } from "./validation.js";

export type SessionNotification = NotificationScope & (
  | { readonly status: "running" | "succeeded"; readonly message: string }
  | { readonly status: "failed" | "cancelled"; readonly message: string; readonly failure: DisplayFailure }
);

export interface NotificationScope {
  readonly type: "notification";
  readonly id: string;
  readonly sessionId: string;
  /** Present for command feedback, absent for other session notifications. */
  readonly commandId?: string;
}

/** General vocabulary; F3.1 only exposes command-owned notifications through a live method. */
export function parseSessionNotification(value: unknown): SessionNotification {
  const event = requireRecord(value, "notification");
  const keys = ["type", "id", "sessionId", "status", "message"];
  const command = Object.hasOwn(event, "commandId")
    ? { commandId: requireBoundedString(event.commandId, "commandId", 128) } : {};
  if (Object.hasOwn(event, "commandId")) keys.push("commandId");
  const scope = {
    type: "notification" as const,
    id: requireBoundedString(event.id, "notification id", 128),
    sessionId: requireBoundedString(event.sessionId, "sessionId", 128),
    ...command,
    message: requireBoundedString(event.message, "notification message", DISPLAY_SUMMARY_MAX_CHARS),
  };
  if (event.type === "notification") {
    if ((event.status === "running" || event.status === "succeeded") && exactKeys(event, keys)) {
      return { ...scope, status: event.status };
    }
    if ((event.status === "failed" || event.status === "cancelled") && exactKeys(event, [...keys, "failure"])) {
      return { ...scope, status: event.status, failure: parseDisplayFailure(event.failure) };
    }
  }
  throw new RpcError("invalid-frame", "Malformed notification");
}
