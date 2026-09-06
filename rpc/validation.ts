import { RpcError } from "./errors.js";
import {
  RPC_MAX_ID_CHARS,
  RPC_MAX_METHOD_CHARS,
  RPC_PROTOCOL_VERSION,
} from "./protocol.js";
import type {
  JsonValue,
  RpcClientFrame,
  RpcFailure,
  RpcServerFrame,
} from "./protocol.js";

export function parseRpcClientFrame(value: unknown): RpcClientFrame {
  const frame = requireRecord(value, "RPC client frame");
  requireVersion(frame);
  if (frame.type === "cancel" && exactKeys(frame, ["version", "type", "id"])) {
    return { version: RPC_PROTOCOL_VERSION, type: "cancel", id: requireId(frame.id) };
  }
  if (frame.type === "open" && exactKeys(frame, ["version", "type", "id", "method", "params"])) {
    if (!isJsonValue(frame.params)) invalid("RPC params must be JSON-safe");
    return {
      version: RPC_PROTOCOL_VERSION,
      type: "open",
      id: requireId(frame.id),
      method: requireBoundedString(frame.method, "method", RPC_MAX_METHOD_CHARS),
      params: frame.params,
    };
  }
  return invalid("Unknown or malformed RPC client frame");
}

export function parseRpcServerFrame(value: unknown): RpcServerFrame {
  const frame = requireRecord(value, "RPC server frame");
  requireVersion(frame);
  if (frame.type === "end" && exactKeys(frame, ["version", "type", "id"])) {
    return { version: RPC_PROTOCOL_VERSION, type: "end", id: requireId(frame.id) };
  }
  if (frame.type === "item" && exactKeys(frame, ["version", "type", "id", "value"])) {
    if (!isJsonValue(frame.value)) invalid("RPC item must be JSON-safe");
    return { version: RPC_PROTOCOL_VERSION, type: "item", id: requireId(frame.id), value: frame.value };
  }
  if (frame.type === "error" && exactKeys(frame, ["version", "type", "id", "error"])) {
    return {
      version: RPC_PROTOCOL_VERSION,
      type: "error",
      id: requireId(frame.id),
      error: parseRpcFailure(frame.error),
    };
  }
  return invalid("Unknown or malformed RPC server frame");
}

export function parseRpcFailure(value: unknown): RpcFailure {
  const failure = requireRecord(value, "RPC failure");
  if (!exactKeys(failure, ["code", "message", "details"])) invalid("Malformed RPC failure");
  const details = requireRecord(failure.details, "RPC failure details");
  if (!isJsonValue(details)) invalid("RPC failure details must be JSON-safe");
  return {
    code: requireBoundedString(failure.code, "failure code", 128),
    message: requireBoundedString(failure.message, "failure message", 4_096),
    details,
  };
}

export function isJsonValue(value: unknown, ancestors = new Set<object>()): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value) && !Object.is(value, -0);
  if (typeof value !== "object" || ancestors.has(value)) return false;
  ancestors.add(value);
  try {
    if (Array.isArray(value)) {
      if (Object.getPrototypeOf(value) !== Array.prototype) return false;
      if (Reflect.ownKeys(value).length !== value.length + 1) return false;
      return value.every((entry, index) => Object.hasOwn(value, index) && isJsonValue(entry, ancestors));
    }
    const prototype: unknown = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) return false;
    return Reflect.ownKeys(value).every((key) => {
      if (typeof key !== "string") return false;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      return descriptor?.enumerable === true && isJsonValue(Reflect.get(value, key), ancestors);
    });
  } finally {
    ancestors.delete(value);
  }
}

export function requireRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return invalid(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

export function exactKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const actual = Reflect.ownKeys(value);
  return actual.length === keys.length && keys.every((key) => Object.hasOwn(value, key));
}

export function requireBoundedString(value: unknown, label: string, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) {
    return invalid(`${label} must be a non-empty string of at most ${maximum} characters`);
  }
  return value;
}

function requireVersion(frame: Record<string, unknown>): void {
  if (frame.version !== RPC_PROTOCOL_VERSION) invalid(`Unsupported RPC version: ${String(frame.version)}`);
}

function requireId(value: unknown): string {
  return requireBoundedString(value, "RPC id", RPC_MAX_ID_CHARS);
}

function invalid(message: string): never {
  throw new RpcError("invalid-frame", message);
}
