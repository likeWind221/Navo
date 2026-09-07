import { RpcError } from "./errors.js";
import { exactKeys, requireBoundedString, requireRecord } from "./validation.js";

/** Safe UI failure only; private exceptions and arbitrary details stay in Host. */
export interface DisplayFailure {
  readonly code: string;
  readonly message: string;
}

export const DISPLAY_SUMMARY_MAX_CHARS = 4_096;

export function parseDisplayFailure(value: unknown): DisplayFailure {
  const failure = requireRecord(value, "display failure");
  if (!exactKeys(failure, ["code", "message"])) throw new RpcError("invalid-frame", "Malformed event fields");
  return { code: requireBoundedString(failure.code, "failure code", 128),
    message: requireBoundedString(failure.message, "failure message", DISPLAY_SUMMARY_MAX_CHARS) };
}

