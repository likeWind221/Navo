import { RpcError } from "./errors.js";
import { exactKeys, requireBoundedString, requireRecord } from "./validation.js";

import { DISPLAY_SUMMARY_MAX_CHARS } from "../shared/content.js";
import type { DisplayFailure } from "../shared/content.js";
export { DISPLAY_SUMMARY_MAX_CHARS } from "../shared/content.js";
export type { DisplayFailure } from "../shared/content.js";

export function parseDisplayFailure(value: unknown): DisplayFailure {
  const failure = requireRecord(value, "display failure");
  if (!exactKeys(failure, ["code", "message"])) throw new RpcError("invalid-frame", "Malformed event fields");
  return { code: requireBoundedString(failure.code, "failure code", 128),
    message: requireBoundedString(failure.message, "failure message", DISPLAY_SUMMARY_MAX_CHARS) };
}

