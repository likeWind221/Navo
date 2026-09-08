import type { TurnResult } from "../../agent/types.js";

export type PublicTurnTerminal = "completed" | "cancelled" | "truncated" | "failed";

/** Classify the shared runtime result before each public API shapes its event. */
export function classifyTurnTerminal(result: TurnResult): PublicTurnTerminal {
  if (result.status === "completed") return "completed";
  if (result.status === "cancelled") return "cancelled";
  if (result.status === "blocked" && result.failure.code === "max-tokens") {
    return "truncated";
  }
  return "failed";
}
