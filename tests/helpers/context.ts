import type { TurnContextSnapshot } from "../../src/context/turn.js";
import type { GenerateRequest } from "../../src/llm/types.js";

export function turnSnapshot(request: GenerateRequest): TurnContextSnapshot {
  const block = request.turnContext?.content[0];
  if (block?.type !== "text") throw new Error("Expected temporary Turn context.");
  return JSON.parse(block.text.slice(block.text.indexOf("\n{") + 1, block.text.lastIndexOf("\n</turn-context>")));
}

export function reminderTexts(request: GenerateRequest): readonly string[] {
  return turnSnapshot(request).sections.flatMap(section => section.kind === "reminder" ? [section.text] : []);
}
