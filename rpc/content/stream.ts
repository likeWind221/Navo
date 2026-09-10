import { parseAgentTurnInput } from "../agent.js";
import type { AgentTurnInput } from "../agent.js";
import type { AgentTurnV2Event } from "../content.js";
import type { RpcMethod, RpcOutputValidator } from "../protocol.js";
import { CONTENT_MAX_CHARS, CONTENT_MAX_COUNT, CONTENT_MAX_EVENTS,
  CONTENT_TURN_MAX_CHARS } from "../content.js";
import { parseTurnEvent } from "./validation.js";
import { RpcError } from "../errors.js";

export const agentTurnV2Method: RpcMethod<AgentTurnInput, AgentTurnV2Event> = Object.freeze({
  name: "agent.turn.v2",
  parseInput: parseAgentTurnInput,
  parseOutput: parseAgentTurnEvent,
  createOutputValidator: createTurnOutputValidator,
});

interface ContentState {
  readonly index: number;
  readonly toolCallId: string | undefined;
  chars: number;
  closed: boolean;
  execution: "pending" | "running" | "settled";
}

/** One bounded state machine per RPC invocation; never reuse after rejection. */
export function createTurnOutputValidator(input: AgentTurnInput): RpcOutputValidator<AgentTurnV2Event> {
  const { sessionId, requestId } = input;
  let turnId: string | undefined;
  let terminal = false;
  let poisoned = false;
  let eventCount = 0;
  let chars = 0;
  let step: { id: string; messageId: string } | undefined;
  const steps = new Set<string>();
  const messages = new Set<string>();
  const callIds = new Set<string>();
  const contents = new Map<number, ContentState>();
  let contentCount = 0;

  const accept = (event: AgentTurnV2Event): void => {
    if (++eventCount > CONTENT_MAX_EVENTS) invalid("Turn event limit exceeded");
    if (terminal) invalid("Event after terminal");
    if (event.sessionId !== sessionId || event.requestId !== requestId) invalid("Request identity mismatch");
    if (turnId === undefined) {
      if (event.type !== "turn-started") invalid("Expected turn-started");
      turnId = event.turnId;
      return;
    }
    if (event.turnId !== turnId || event.type === "turn-started") invalid("Turn identity or start order mismatch");
    if (event.type === "turn-completed" || event.type === "turn-cancelled"
      || event.type === "turn-failed" || event.type === "turn-truncated") {
      if (event.type === "turn-completed" && (step !== undefined || steps.size === 0)) {
        invalid("Completed turn requires completed steps");
      }
      terminal = true;
      contents.clear();
      return;
    }
    if (!("stepId" in event)) invalid("Expected step event");
    if (event.type === "step-started") {
      if (step !== undefined || steps.has(event.stepId) || messages.has(event.messageId)) {
        invalid("Duplicate or overlapping step");
      }
      steps.add(event.stepId);
      messages.add(event.messageId);
      step = { id: event.stepId, messageId: event.messageId };
      contents.clear();
      return;
    }
    if (step === undefined || step.id !== event.stepId || step.messageId !== event.messageId) {
      invalid("Step or message identity mismatch");
    }
    if (event.type === "step-completed") {
      if ([...contents.values()].some(content => !content.closed
        || (content.toolCallId !== undefined && content.execution !== "settled"))) {
        invalid("Step has unfinished content or tools");
      }
      step = undefined;
      return;
    }
    if (!("contentIndex" in event)) invalid("Expected content event");
    if (event.type === "content-started") {
      if (contents.has(event.contentIndex) || contentCount >= CONTENT_MAX_COUNT) {
        invalid("Duplicate or excessive content");
      }
      const toolCallId = event.kind === "tool-call" ? event.toolCallId : undefined;
      if (toolCallId !== undefined) {
        if (callIds.has(toolCallId)) invalid("Duplicate toolCallId");
        callIds.add(toolCallId);
      }
      const content: ContentState = { index: event.contentIndex, toolCallId,
        chars: 0, closed: false, execution: "pending" };
      contentCount += 1;
      contents.set(event.contentIndex, content);
      return;
    }
    const content = contents.get(event.contentIndex);
    if (content === undefined) invalid("Unknown content");
    if (event.type === "content-delta" || event.type === "content-completed") {
      if (content.closed) invalid("Content is not open");
      if (event.type === "content-delta") {
        content.chars += event.delta.length;
        chars += event.delta.length;
        if (content.chars > CONTENT_MAX_CHARS) invalid("Content text limit exceeded");
      } else {
        content.closed = true;
      }
    } else {
      if (content.toolCallId === undefined
        || content.toolCallId !== event.toolCallId
        || !content.closed) {
        invalid("Tool result association or argument completion mismatch");
      }
      if (event.type === "tool-started") {
        if (content.execution !== "pending") invalid("Tool already started or settled");
        content.execution = "running";
      } else {
        if (content.execution === "settled"
          || (event.status === "succeeded" && content.execution !== "running")) {
          invalid("Tool result order mismatch");
        }
        content.execution = "settled";
        chars += event.summary.length + event.detail.length;
      }
    }
    if (chars > CONTENT_TURN_MAX_CHARS) invalid("Turn content limit exceeded");
  };
  return {
    parse(value: unknown): AgentTurnV2Event {
      if (poisoned) invalid("Validator is closed after rejection");
      try {
        const event = parseAgentTurnEvent(value);
        accept(event);
        return event;
      } catch (error) {
        poisoned = true;
        throw error;
      }
    },
    end(): void {
      if (poisoned || !terminal) {
        poisoned = true;
        invalid("Stream ended without a valid business terminal");
      }
    },
  };
}

function parseAgentTurnEvent(value: unknown): AgentTurnV2Event {
  const event = parseTurnEvent(value);
  if ("commandId" in event) invalid("agent.turn does not accept command events");
  return event;
}

function invalid(message: string): never {
  throw new RpcError("invalid-output", message);
}
