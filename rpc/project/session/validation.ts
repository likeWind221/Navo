import { RpcError } from "../../errors.js";
import type {
  ProjectSessionRecoveryEntryV1,
  ProjectSessionRecoveryInputV1,
  ProjectSessionRecoveryV1,
  ProjectSessionTurnV1,
} from "../session.js";
import { exactKeys, requireBoundedString, requireRecord } from "../../validation.js";

const ID_MAX = 128;
const TIMESTAMP_MAX = 64;

export function parseProjectSessionRecoveryInput(value: unknown): ProjectSessionRecoveryInputV1 {
  const input = shape(value, ["projectId"], "project session recovery input");
  return { projectId: id(input.projectId, "projectId") };
}

export function parseProjectSessionRecovery(value: unknown): ProjectSessionRecoveryV1 {
  const recovery = shape(value, ["projectId", "sessions"], "project session recovery");
  return {
    projectId: id(recovery.projectId, "projectId"),
    sessions: array(recovery.sessions, "sessions").map(parseProjectSessionRecoveryEntry),
  };
}

function parseProjectSessionRecoveryEntry(value: unknown): ProjectSessionRecoveryEntryV1 {
  const entry = requireRecord(value, "project session recovery entry");
  const owner = parseProjectSessionOwner(entry.owner);
  if (entry.status === "unestablished" && exactKeys(entry, ["owner", "status"])) {
    return { owner, status: "unestablished" };
  }
  if (entry.status === "unavailable" && exactKeys(entry, ["owner", "status", "sessionId", "reason"])
    && entry.reason === "not-readable") {
    return { owner, status: "unavailable", sessionId: id(entry.sessionId, "sessionId"), reason: "not-readable" };
  }
  if (entry.status === "available" && exactKeys(entry, ["owner", "status", "sessionId", "lastEndedTurn"])) {
    return {
      owner,
      status: "available",
      sessionId: id(entry.sessionId, "sessionId"),
      lastEndedTurn: entry.lastEndedTurn === null ? null : parseProjectSessionTurn(entry.lastEndedTurn),
    };
  }
  return invalid("Malformed project session recovery entry");
}

function parseProjectSessionOwner(value: unknown): ProjectSessionRecoveryEntryV1["owner"] {
  const owner = requireRecord(value, "project session owner");
  if (owner.kind === "main" && exactKeys(owner, ["kind"])) return { kind: "main" };
  if (owner.kind === "node" && exactKeys(owner, ["kind", "nodeId"])) {
    return { kind: "node", nodeId: id(owner.nodeId, "nodeId") };
  }
  return invalid("Malformed project session owner");
}

function parseProjectSessionTurn(value: unknown): ProjectSessionTurnV1 {
  const turn = shape(value, ["turnId", "status", "startedAt", "endedAt", "interruption"], "project session turn");
  return {
    turnId: id(turn.turnId, "turnId"),
    status: oneOf(turn.status, ["completed", "blocked", "cancelled", "failed"] as const, "turn status"),
    startedAt: timestamp(turn.startedAt, "startedAt"),
    endedAt: timestamp(turn.endedAt, "endedAt"),
    interruption: turn.interruption === null
      ? null
      : oneOf(turn.interruption, ["host-stopped", "context-compaction"] as const, "interruption"),
  };
}

function shape(value: unknown, keys: readonly string[], label: string): Record<string, unknown> {
  const record = requireRecord(value, label);
  if (!exactKeys(record, keys)) invalid(`Malformed ${label}`);
  return record;
}

function array(value: unknown, label: string): readonly unknown[] {
  if (!Array.isArray(value)) invalid(`${label} must be an array`);
  return value;
}

function id(value: unknown, label: string): string {
  return requireBoundedString(value, label, ID_MAX);
}

function timestamp(value: unknown, label: string): string {
  const result = requireBoundedString(value, label, TIMESTAMP_MAX);
  if (!Number.isFinite(Date.parse(result))) invalid(`${label} must be an ISO timestamp`);
  return result;
}

function oneOf<const T extends readonly string[]>(value: unknown, allowed: T, label: string): T[number] {
  if (typeof value !== "string" || !allowed.includes(value)) invalid(`Invalid ${label}`);
  return value as T[number];
}

function invalid(message: string): never {
  throw new RpcError("invalid-frame", message);
}
