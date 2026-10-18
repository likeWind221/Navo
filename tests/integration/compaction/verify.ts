import type { Message } from "../../../src/llm/types.js";
import { applySurface, createSurface } from "../../../src/session/surface.js";
import type { SessionEvent } from "../../../src/session/types.js";

export function compactionEvents(events: readonly SessionEvent[]) {
  return events.filter(event =>
    event.type === "compaction-started"
    || event.type === "compaction-checkpoint"
    || event.type === "compaction-ended");
}

export function completedCompactions(events: readonly SessionEvent[]): number {
  return events.filter(event => event.type === "compaction-ended" && event.data.status === "completed").length;
}

export function assertToolPairs(events: readonly SessionEvent[]): void {
  const pending = new Map<string, number>();
  events.forEach((event, index) => {
    if (event.type === "tool-call-requested") {
      if (pending.has(event.data.toolCall.id)) throw new Error("A tool call was requested twice.");
      pending.set(event.data.toolCall.id, index);
      return;
    }
    if (event.type !== "tool-call-result") return;
    const block = event.data.message.content[0]!;
    if (!pending.delete(block.toolCallId)) {
      throw new Error(`Tool result ${block.toolCallId} has no preceding call.`);
    }
  });
  if (pending.size > 0) {
    throw new Error(`Tool calls without results: ${[...pending.keys()].join(", ")}.`);
  }
}

export function assertSelectionPairs(events: readonly SessionEvent[]): void {
  events.forEach((event, index) => {
    if (event.type !== "compaction-started") return;
    const surface = createSurface();
    for (let cursor = 0; cursor < index; cursor += 1) applySurface(surface, events[cursor]!);
    const start = surface.nodes.indexOf(event.data.coveredStart);
    const end = surface.nodes.indexOf(event.data.coveredEnd);
    if (start !== 0 || end < start) {
      throw new Error(`Compaction ${event.data.compactionId} does not cover a prefix of its current surface.`);
    }
    const pending = new Set<string>();
    for (const sequence of surface.nodes.slice(0, end + 1)) {
      const entry = events[sequence - 1]!;
      if (entry.type === "assistant-message") {
        for (const block of entry.data.message.content) {
          if (block.type === "tool-call") pending.add(block.id);
        }
      }
      if (entry.type === "tool-call-result" && !pending.delete(entry.data.message.content[0]!.toolCallId)) {
        throw new Error(`Compaction ${event.data.compactionId} selects orphan tool result ${entry.data.message.content[0]!.toolCallId}.`);
      }
    }
    if (pending.size > 0) {
      throw new Error(`Compaction ${event.data.compactionId} splits tool calls ${[...pending].join(", ")} from their results.`);
    }
  });
}

export function assertSurfacePairs(messages: readonly Message[]): void {
  const pending = new Set<string>();
  for (const message of messages) {
    for (const block of message.content) {
      if (block.type === "tool-call") pending.add(block.id);
      if (block.type === "tool-result" && !pending.delete(block.toolCallId)) {
        throw new Error(`Visible history has orphan tool result ${block.toolCallId}.`);
      }
    }
  }
  if (pending.size > 0) {
    throw new Error(`Visible history keeps calls without results: ${[...pending].join(", ")}.`);
  }
}

export function assertInterruptedRepair(
  events: readonly SessionEvent[],
  compactionId: string,
  turnId: string,
): void {
  const started = events.find(event =>
    event.type === "compaction-started" && event.data.compactionId === compactionId);
  if (started?.type !== "compaction-started" || started.data.trigger !== "pressure"
    || started.data.turnId !== turnId) {
    throw new Error(`Compaction ${compactionId} was not a pressure compaction of turn ${turnId}.`);
  }
  const ended = events.filter(event =>
    event.type === "compaction-ended" && event.data.compactionId === compactionId);
  if (ended.length !== 1) throw new Error(`Compaction ${compactionId} has ${ended.length} endings.`);
  if (ended[0]!.type !== "compaction-ended" || ended[0]!.data.status !== "interrupted") {
    throw new Error(`Compaction ${compactionId} was not closed as interrupted.`);
  }
  const turnEnded = events.filter(event => event.type === "turn-ended" && event.data.turnId === turnId);
  if (turnEnded.length !== 1 || turnEnded[0]!.type !== "turn-ended" || turnEnded[0]!.data.status !== "failed") {
    throw new Error(`Interrupted turn ${turnId} was not closed as failed exactly once.`);
  }
  const interruptedErrors = events.filter(event =>
    event.type === "error" && event.data.turnId === turnId && event.data.failure.code === "interrupted");
  if (interruptedErrors.length !== 1) {
    throw new Error(`Interrupted turn ${turnId} has ${interruptedErrors.length} interrupted errors.`);
  }
  const compactionIndex = events.findIndex(event =>
    event.type === "compaction-ended" && event.data.compactionId === compactionId);
  const turnIndex = events.findIndex(event =>
    event.type === "turn-ended" && event.data.turnId === turnId);
  if (compactionIndex < 0 || turnIndex < 0 || compactionIndex > turnIndex) {
    throw new Error(`Compaction ${compactionId} was not closed before interrupted turn ${turnId}.`);
  }
}

export function loggedMessageIds(events: readonly SessionEvent[]): string[] {
  return events.flatMap(event =>
    event.type === "user-message"
      || event.type === "assistant-message"
      || event.type === "tool-call-result"
      || event.type === "compaction-checkpoint"
      ? [event.data.message.id]
      : []);
}

export function summaryCount(purposes: readonly string[]): number {
  return purposes.filter(purpose => purpose === "summary").length;
}
