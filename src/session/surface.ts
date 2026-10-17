import type { SessionId } from "../brand/ids.js";
import { createMessageId } from "../brand/ids.js";
import type { Message } from "../llm/types.js";
import type { SessionEvent } from "./types.js";

export interface SurfaceState {
  readonly nodes: number[];
  derived: Message[];
  derivedNodes: number;
  generation: number;
  derivedGeneration: number;
}

export function createSurface(): SurfaceState {
  return { nodes: [], derived: [], derivedNodes: 0, generation: 0, derivedGeneration: 0 };
}

export function applySurface(surface: SurfaceState, event: SessionEvent): void {
  if (event.type !== "user-message" && event.type !== "assistant-message" && event.type !== "tool-call-result" && event.type !== "compaction-checkpoint") {
    if (event.surfaceOp !== undefined) throw new TypeError("Log-only events cannot alter the model surface.");
    return;
  }
  const op = event.surfaceOp ?? "append";
  if (op === "append") {
    surface.nodes.push(event.sequence);
    return;
  }
  const start = surface.nodes.indexOf(op.start);
  const end = surface.nodes.indexOf(op.end);
  if (start < 0 || end < start) throw new RangeError("Surface replacement bounds must name an ordered current range.");
  surface.nodes.splice(start, end - start + 1, event.sequence);
  surface.generation += 1;
}

export function eventMessage(event: SessionEvent): Message | undefined {
  switch (event.type) {
    case "user-message":
    case "tool-call-result":
    case "compaction-checkpoint":
      return event.data.message;
    case "assistant-message":
      return event.data.message.content.length === 0 && event.data.message.replay === undefined
        ? undefined : event.data.message;
    default:
      return undefined;
  }
}

export function withSystemPrompt(
  messages: readonly Message[],
  sessionId: SessionId,
  systemPrompt: string | undefined,
): readonly Message[] {
  if (systemPrompt === undefined) return Object.freeze([...messages]);
  return Object.freeze([{
    id: createMessageId(`system-${sessionId}`),
    role: "system",
    content: [{ type: "text", text: systemPrompt }],
  }, ...messages]);
}

