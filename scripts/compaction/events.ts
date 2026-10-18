import assert from "node:assert/strict";

import type { Context } from "cordis";

import type { SessionId } from "../../src/brand/ids.js";
import { estimateMessage, estimateRequest } from "../../src/context/meter.js";
import type { Message } from "../../src/llm/types.js";
import type { SessionEvent } from "../../src/session/types.js";

type StartedEvent = Extract<SessionEvent, { type: "compaction-started" }>;
type CheckpointEvent = Extract<SessionEvent, { type: "compaction-checkpoint" }>;
type EndedEvent = Extract<SessionEvent, { type: "compaction-ended" }>;

export interface LaterRequest {
  readonly sequence: number;
  readonly stepId: string;
  readonly messageCount: number;
  readonly estimatedTokens: number;
}

export interface CompactionRecord {
  readonly compactionId: string;
  readonly sessionId: string;
  readonly turnId: string | null;
  readonly trigger: string;
  readonly coveredStart: number;
  readonly coveredEnd: number;
  readonly checkpointSequence: number | null;
  readonly checkpointMessageId: string | null;
  readonly checkpointChars: number;
  readonly checkpointTokens: number;
  readonly status: string;
  readonly beforeTokens: number | null;
  readonly afterTokens: number | null;
  readonly savings: number | null;
  readonly summaryTokens: number | null;
  readonly usage: unknown;
  readonly failure: unknown;
  readonly generationAfter: number;
  readonly laterTaskRequests: readonly LaterRequest[];
}

export interface SessionEvidence {
  readonly sessionId: string;
  readonly eventCount: number;
  readonly eventTypes: Readonly<Record<string, number>>;
  readonly surfaceGeneration: number;
  readonly surfaceSequences: readonly number[];
  readonly surfaceMessageIds: readonly string[];
  readonly derivedCount: number;
  readonly derivedTokens: number;
  readonly maxParallelReadCalls: number;
  readonly compactions: readonly CompactionRecord[];
}

export interface CapturedSession {
  readonly evidence: SessionEvidence;
  readonly events: readonly SessionEvent[];
  readonly derived: readonly Message[];
}

export function captureSession(app: Context, sessionId: SessionId): CapturedSession {
  const events = app.sessions.getEvents(sessionId);
  const derived = app.sessions.deriveMessages(sessionId);
  const surface = app.sessions.getSurfaceSnapshot(sessionId);
  const eventTypes: Record<string, number> = {};
  for (const event of events) eventTypes[event.type] = (eventTypes[event.type] ?? 0) + 1;
  return Object.freeze({
    events,
    derived,
    evidence: Object.freeze({
      sessionId: String(sessionId),
      eventCount: events.length,
      eventTypes: Object.freeze(eventTypes),
      surfaceGeneration: surface.generation,
      surfaceSequences: Object.freeze([...surface.sequences]),
      surfaceMessageIds: Object.freeze(surface.entries.flatMap(entry => (
        entry.message === undefined ? [] : [String(entry.message.id)]
      ))),
      derivedCount: derived.length,
      derivedTokens: estimateRequest({ messages: derived, tools: [] }),
      maxParallelReadCalls: maxParallelReadsInEvents(events),
      compactions: compactionRecords(app, sessionId),
    }),
  });
}

export function assertSessionRestart(before: CapturedSession, after: CapturedSession): void {
  assert.deepEqual(after.events, before.events, `Session ${before.evidence.sessionId} events changed across restart.`);
  assert.deepEqual(after.derived, before.derived, `Session ${before.evidence.sessionId} history changed across restart.`);
  assert.deepEqual(
    after.evidence,
    before.evidence,
    `Session ${before.evidence.sessionId} surface or compaction state changed across restart.`,
  );
}

export function compactionRecords(app: Context, sessionId: SessionId): readonly CompactionRecord[] {
  const events = app.sessions.getEvents(sessionId);
  const starts = new Map<string, StartedEvent>();
  const checkpoints = new Map<string, CheckpointEvent>();
  const ended = new Map<string, EndedEvent>();
  const checkpointGeneration = new Map<string, number>();
  const endedGeneration = new Map<string, number>();
  let generation = 0;
  for (const event of events) {
    if (event.type === "compaction-started") {
      starts.set(event.data.compactionId, event);
    } else if (event.type === "compaction-checkpoint") {
      generation += 1;
      checkpoints.set(event.data.compactionId, event);
      checkpointGeneration.set(event.data.compactionId, generation);
    } else if (event.type === "compaction-ended") {
      ended.set(event.data.compactionId, event);
      endedGeneration.set(event.data.compactionId, generation);
    }
  }
  return [...starts.values()].map((start) => {
    const checkpoint = checkpoints.get(start.data.compactionId);
    const end = ended.get(start.data.compactionId);
    const checkpointText = checkpoint === undefined ? "" : messageText(checkpoint.data.message);
    const before = end?.data.beforeTokens ?? null;
    const after = end?.data.afterTokens ?? null;
    return Object.freeze({
      compactionId: start.data.compactionId,
      sessionId: String(sessionId),
      turnId: start.data.turnId === undefined ? null : String(start.data.turnId),
      trigger: start.data.trigger,
      coveredStart: start.data.coveredStart,
      coveredEnd: start.data.coveredEnd,
      checkpointSequence: checkpoint?.sequence ?? null,
      checkpointMessageId: checkpoint === undefined ? null : String(checkpoint.data.message.id),
      checkpointChars: checkpointText.length,
      checkpointTokens: checkpoint === undefined ? 0 : estimateMessage(checkpoint.data.message),
      status: end?.data.status ?? "missing",
      beforeTokens: before,
      afterTokens: after,
      savings: before === null || after === null ? null : before - after,
      summaryTokens: end?.data.summaryTokens ?? null,
      usage: end?.data.usage ?? null,
      failure: end?.data.failure ?? null,
      generationAfter: endedGeneration.get(start.data.compactionId)
        ?? checkpointGeneration.get(start.data.compactionId) ?? 0,
      laterTaskRequests: checkpoint === undefined
        ? []
        : laterTaskRequests(events, checkpoint.sequence, checkpoint.data.message.id),
    });
  });
}

export function maxParallelReadCalls(app: Context, sessionId: SessionId): number {
  return maxParallelReadsInEvents(app.sessions.getEvents(sessionId));
}

function maxParallelReadsInEvents(events: readonly SessionEvent[]): number {
  let maximum = 0;
  for (const event of events) {
    if (event.type !== "assistant-message") continue;
    const reads = event.data.message.content.filter(block => block.type === "tool-call" && block.name === "read").length;
    if (reads > maximum) maximum = reads;
  }
  return maximum;
}

function laterTaskRequests(
  events: readonly SessionEvent[],
  sequence: number,
  messageId: string,
): readonly LaterRequest[] {
  return events.flatMap(event => {
    if (event.sequence <= sequence || event.type !== "llm-requested") return [];
    if ((event.data.tools?.length ?? 0) === 0) return [];
    if (!event.data.messages.some(message => String(message.id) === messageId)) return [];
    return [Object.freeze({
      sequence: event.sequence,
      stepId: String(event.data.stepId),
      messageCount: event.data.messages.length,
      estimatedTokens: estimateRequest({ messages: event.data.messages, tools: event.data.tools ?? [] }),
    })];
  });
}

function messageText(message: Message): string {
  return message.content.flatMap(block => block.type === "text" ? [block.text] : []).join("\n");
}
