import type { Context } from "cordis";

import type {
  SessionHistoryContentV1,
  SessionHistoryEntryV1,
  SessionHistoryInputV1,
  SessionHistoryMessageV1,
  SessionHistoryV1,
} from "../../../rpc/session.js";
import type { SessionId } from "../../brand/ids.js";
import type { Message, MessageContent } from "../../llm/types.js";
import { sessionFailure } from "./failure.js";

export function readSessionHistory(
  ctx: Context,
  sessionId: SessionId,
  input: SessionHistoryInputV1,
): SessionHistoryV1 {
  const surface = ctx.sessions.getSurfaceSnapshot(sessionId);
  const cursor = input.cursor;
  if (cursor !== undefined && cursor.surfaceGeneration !== surface.generation) {
    throw sessionFailure(
      "history-changed",
      "Session history changed; restart from the first page.",
      { surfaceGeneration: surface.generation },
    );
  }
  const events = ctx.sessions.getEvents(sessionId);
  const entries: SessionHistoryEntryV1[] = [];
  for (const entry of surface.entries) {
    if (entry.message === undefined) continue;
    const event = events[entry.sequence - 1];
    if (event === undefined) throw new Error(`Surface references missing event ${entry.sequence}.`);
    if (event.type === "compaction-checkpoint") {
      entries.push({
        kind: "summary-checkpoint",
        sequence: entry.sequence,
        timestamp: event.timestamp,
        message: toHistoryMessage(entry.message),
        compactionId: event.data.compactionId,
        coveredStart: event.data.coveredStart,
        coveredEnd: event.data.coveredEnd,
        summaryVersion: event.data.summaryVersion,
      });
    } else {
      entries.push({
        kind: "message",
        sequence: entry.sequence,
        timestamp: event.timestamp,
        message: toHistoryMessage(entry.message),
      });
    }
  }
  const offset = cursor?.offset ?? 0;
  const page = entries.slice(offset, offset + input.limit);
  const nextOffset = offset + page.length;
  return {
    sessionId,
    surfaceGeneration: surface.generation,
    entries: page,
    nextCursor: nextOffset < entries.length
      ? { surfaceGeneration: surface.generation, offset: nextOffset }
      : null,
  };
}

function toHistoryMessage(message: Message): SessionHistoryMessageV1 {
  if (message.role === "system") throw new Error("Session surface contains a system message.");
  return {
    id: message.id,
    role: message.role,
    content: message.content.map(toHistoryContent),
  };
}

function toHistoryContent(block: MessageContent): SessionHistoryContentV1 {
  switch (block.type) {
    case "text":
    case "reasoning":
      return { type: block.type, text: block.text };
    case "tool-call":
      return { type: "tool-call", id: block.id, name: block.name, arguments: block.arguments };
    case "tool-result":
      return {
        type: "tool-result",
        toolCallId: block.toolCallId,
        content: block.content.map(toHistoryContent),
        isError: block.isError,
      };
  }
}
