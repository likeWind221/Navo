import {
  createEventId,
  createMessageId,
} from "../brand/ids.js";
import type {
  SessionId,
  StepId,
  ToolCallId,
  TurnId,
} from "../brand/ids.js";
import type { ToolCallContentBlock } from "../llm/types.js";
import { parseSessionEvent } from "./history.js";
import type { SessionEvent } from "./types.js";

export const TOOL_NOT_STARTED = "tool-not-started";
export const TOOL_OUTCOME_UNKNOWN = "tool-outcome-unknown";
export const TURN_INTERRUPTED = "interrupted";

interface PendingToolCall {
  readonly toolCall: ToolCallContentBlock;
  readonly turnId: TurnId;
  readonly stepId: StepId;
  started: boolean;
}

export function interruptedTurnClosers(
  sessionId: SessionId,
  events: readonly SessionEvent[],
): readonly SessionEvent[] {
  let openTurn: TurnId | undefined;
  let openStep: StepId | undefined;
  const pending = new Map<ToolCallId, PendingToolCall>();

  for (const event of events) {
    switch (event.type) {
      case "turn-started":
        openTurn = event.data.turnId;
        openStep = undefined;
        pending.clear();
        break;
      case "turn-ended":
        if (event.data.turnId === openTurn) {
          openTurn = undefined;
          openStep = undefined;
          pending.clear();
        }
        break;
      case "step-started":
        if (event.data.turnId === openTurn) {
          openStep = event.data.stepId;
          pending.clear();
        }
        break;
      case "step-ended":
        if (event.data.turnId === openTurn && event.data.stepId === openStep) {
          openStep = undefined;
          pending.clear();
        }
        break;
      case "assistant-message":
        if (event.data.turnId === openTurn && event.data.stepId === openStep) {
          for (const block of event.data.message.content) {
            if (block.type === "tool-call") {
              pending.set(block.id, {
                toolCall: block,
                turnId: event.data.turnId,
                stepId: event.data.stepId,
                started: false,
              });
            }
          }
        }
        break;
      case "tool-call-requested":
        if (event.data.turnId === openTurn && event.data.stepId === openStep) {
          const call = pending.get(event.data.toolCall.id) ?? {
            toolCall: event.data.toolCall,
            turnId: event.data.turnId,
            stepId: event.data.stepId,
            started: false,
          };
          call.started = true;
          pending.set(event.data.toolCall.id, call);
        }
        break;
      case "tool-call-result":
        if (event.data.turnId === openTurn && event.data.stepId === openStep) {
          pending.delete(event.data.message.content[0].toolCallId);
        }
        break;
      default:
        break;
    }
  }

  const last = events.at(-1);
  if (openTurn === undefined || last === undefined) return Object.freeze([]);

  const closers: SessionEvent[] = [];
  for (const call of pending.values()) {
    const code = call.started ? TOOL_OUTCOME_UNKNOWN : TOOL_NOT_STARTED;
    const message = call.started
      ? "Tool execution was recorded, but no durable result was saved before interruption. It may have partially completed; inspect external state before deciding whether to retry."
      : "The tool call was interrupted before execution was recorded. It was not run and will not be retried automatically.";
    closers.push(record(sessionId, last.timestamp, events.length + closers.length + 1, {
      type: "tool-call-result",
      data: {
        turnId: call.turnId,
        stepId: call.stepId,
        message: {
          id: createMessageId(`recovery:${sessionId}:${events.length + closers.length + 1}:message`),
          role: "user",
          content: [{
            type: "tool-result",
            toolCallId: call.toolCall.id,
            isError: true,
            content: [{ type: "text", text: message }],
          }],
        },
      },
      surfaceOp: "append",
    }));
    closers.push(record(sessionId, last.timestamp, events.length + closers.length + 1, {
      type: "error",
      data: {
        turnId: call.turnId,
        stepId: call.stepId,
        toolCallId: call.toolCall.id,
        source: "tool",
        failure: { code, message },
      },
    }));
  }

  closers.push(record(sessionId, last.timestamp, events.length + closers.length + 1, {
    type: "error",
    data: {
      turnId: openTurn,
      ...(openStep === undefined ? {} : { stepId: openStep }),
      source: "runtime",
      failure: {
        code: TURN_INTERRUPTED,
        message: "Turn was interrupted because the Host stopped before it recorded completion.",
      },
    },
  }));
  if (openStep !== undefined) {
    closers.push(record(sessionId, last.timestamp, events.length + closers.length + 1, {
      type: "step-ended",
      data: { turnId: openTurn, stepId: openStep, status: "failed" },
    }));
  }
  closers.push(record(sessionId, last.timestamp, events.length + closers.length + 1, {
    type: "turn-ended",
    data: { turnId: openTurn, status: "failed" },
  }));
  return Object.freeze(closers);
}

type RecoveryEvent = Omit<SessionEvent, "id" | "sessionId" | "sequence" | "timestamp">;

function record(
  sessionId: SessionId,
  timestamp: string,
  sequence: number,
  event: RecoveryEvent,
): SessionEvent {
  return parseSessionEvent(sessionId, {
    ...event,
    id: createEventId(`recovery:${sessionId}:${sequence}`),
    sessionId,
    sequence,
    timestamp,
  }, sequence);
}
