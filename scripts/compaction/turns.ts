import type { Context } from "cordis";

import type { ProjectId, SessionId, TurnId } from "../../src/brand/ids.js";
import type { SessionEvent } from "../../src/session/types.js";
import { SUBMIT_COMPLETION_TOOL_NAME } from "../../src/tools/builtins/node/submit.js";
import { SUBMIT_REVIEW_TOOL_NAME } from "../../src/tools/builtins/project/review.js";
import { captureTurn } from "../longterm/evidence.js";

interface RecordedCall {
  readonly id: string;
  readonly name: string;
  readonly arguments: string;
  readonly result: { readonly isError: boolean; readonly text: string } | null;
}

export interface TurnToolCall {
  readonly name: string;
  readonly arguments: unknown;
  readonly resultChars: number | null;
  readonly isError: boolean | null;
}

export interface TurnSummary {
  readonly sessionId: string;
  readonly turnId: string;
  readonly status: string;
  readonly steps: number;
  readonly calls: readonly string[];
  readonly toolCalls: readonly TurnToolCall[];
  readonly readPaths: readonly string[];
  readonly submitReviewDecisions: readonly string[];
  readonly submitCompletion: {
    readonly resourceIds: readonly string[];
    readonly satisfied: number;
    readonly total: number;
    readonly remaining: number;
  } | null;
  readonly errorCodes: readonly string[];
  readonly unrecovered: number;
  readonly answer: { readonly count: number; readonly chars: number; readonly containsTotal: boolean };
}

export function turnSummaries(
  app: Context,
  projectId: ProjectId,
  expectedTotalSum: number,
): readonly TurnSummary[] {
  const project = app.projects.get(projectId);
  if (project === undefined) return [];
  const sessions: SessionId[] = [
    project.mainSessionId,
    ...app.nodes.getByProject(projectId).flatMap(node => node.sessionId === undefined ? [] : [node.sessionId]),
  ];
  return sessions.flatMap((sessionId) => {
    const events = app.sessions.getEvents(sessionId);
    return events.filter((event): event is Extract<SessionEvent, { type: "turn-started" }> => event.type === "turn-started")
      .map(event => summarizeTurn(app, projectId, sessionId, event.data.turnId, events, expectedTotalSum));
  });
}

function summarizeTurn(
  app: Context,
  projectId: ProjectId,
  sessionId: SessionId,
  turnId: TurnId,
  events: readonly SessionEvent[],
  expectedTotalSum: number,
): TurnSummary {
  const captured = captureTurn(app, projectId, sessionId, turnId);
  const calls = recordedCalls(captured.record);
  const successful = calls.filter(call => call.result !== null && !call.result.isError);
  const readPaths = successful.filter(call => call.name === "read")
    .flatMap(call => {
      const path = toolArguments(call.arguments)?.path;
      return typeof path === "string" ? [path] : [];
    });
  const reviewDecisions = successful.filter(call => call.name === SUBMIT_REVIEW_TOOL_NAME)
    .flatMap(call => {
      const decision = toolArguments(call.arguments)?.decision;
      return typeof decision === "string" ? [decision] : [];
    });
  const submission = successful.filter(call => call.name === SUBMIT_COMPLETION_TOOL_NAME).at(-1);
  const ended = events.find(event => event.type === "turn-ended" && event.data.turnId === turnId);
  const steps = events.filter(event => event.type === "step-started" && event.data.turnId === turnId).length;
  const answers = captured.answers.join("\n");
  return Object.freeze({
    sessionId: String(sessionId),
    turnId: String(turnId),
    status: ended?.type === "turn-ended" ? ended.data.status : "missing",
    steps,
    calls: Object.freeze(calls.map(call => call.name)),
    toolCalls: Object.freeze(calls.map(call => Object.freeze({
      name: call.name,
      arguments: parseArguments(call.arguments),
      resultChars: call.result === null ? null : call.result.text.length,
      isError: call.result === null ? null : call.result.isError,
    }))),
    readPaths: Object.freeze(readPaths),
    submitReviewDecisions: Object.freeze(reviewDecisions),
    submitCompletion: submission === undefined ? null : completionSummary(toolArguments(submission.arguments)),
    errorCodes: Object.freeze(captured.errors.flatMap(errorCode)),
    unrecovered: captured.unrecovered.length,
    answer: Object.freeze({
      count: captured.answers.length,
      chars: answers.length,
      containsTotal: answers.includes(String(expectedTotalSum)),
    }),
  });
}

function recordedCalls(record: Record<string, unknown>): readonly RecordedCall[] {
  const value = record.calls;
  return Array.isArray(value) ? value as readonly RecordedCall[] : [];
}

function completionSummary(args: Record<string, unknown> | undefined): TurnSummary["submitCompletion"] {
  if (args === undefined) return null;
  const resourceIds = Array.isArray(args.resource_ids)
    ? args.resource_ids.filter((id): id is string => typeof id === "string")
    : [];
  const criteria = Array.isArray(args.criteria) ? args.criteria : [];
  const satisfied = criteria.filter(entry => {
    return entry !== null && typeof entry === "object" && !Array.isArray(entry)
      && (entry as Record<string, unknown>).satisfied === true;
  }).length;
  const remaining = Array.isArray(args.remaining) ? args.remaining.length : 0;
  return Object.freeze({ resourceIds: Object.freeze(resourceIds), satisfied, total: criteria.length, remaining });
}

function toolArguments(text: string): Record<string, unknown> | undefined {
  const value = parseArguments(text);
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function parseArguments(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function errorCode(value: unknown): string[] {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [];
  const failure = (value as Record<string, unknown>).failure;
  if (failure === null || typeof failure !== "object" || Array.isArray(failure)) return [];
  const code = (failure as Record<string, unknown>).code;
  return typeof code === "string" ? [code] : [];
}
