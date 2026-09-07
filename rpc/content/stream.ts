import { parseAgentTurnInput } from "../agent.js";
import type { AgentTurnInput } from "../agent.js";
import type { AssistantEvent } from "../content.js";
import type { RpcMethod, RpcOutputValidator } from "../protocol.js";
import { CONTENT_BLOCK_MAX_CHARS, CONTENT_MAX_BLOCKS, CONTENT_MAX_EVENTS,
  CONTENT_MAX_STEPS, CONTENT_TURN_MAX_CHARS } from "../content.js";
import { parseAssistantEvent } from "./validation.js";
import { RpcError } from "../errors.js";

export const assistantTurnMethod: RpcMethod<AgentTurnInput, AssistantEvent> = Object.freeze({
  name: "agent.turn.v2",
  parseInput: parseAgentTurnInput,
  parseOutput: parseAssistantEvent,
  createOutputValidator: createAssistantOutputValidator,
});

interface BlockState {
  readonly id: string;
  readonly toolCallId: string | undefined;
  chars: number;
  closed: boolean;
  execution: "pending" | "running" | "settled";
}

/** One bounded state machine per RPC invocation; never reuse after rejection. */
export function createAssistantOutputValidator(input: AgentTurnInput): RpcOutputValidator<AssistantEvent> {
  const { sessionId, requestId } = input;
  let turnId: string | undefined;
  let terminal = false;
  let poisoned = false;
  let events = 0;
  let chars = 0;
  let step: { id: string; messageId: string } | undefined;
  const steps = new Set<string>();
  const messages = new Set<string>();
  const blockIds = new Set<string>();
  const callIds = new Set<string>();
  const blocks = new Map<string, BlockState>();

  const accept = (event: AssistantEvent): void => {
    if (terminal || ++events > CONTENT_MAX_EVENTS) invalid("Event after terminal or event limit exceeded");
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
      blocks.clear();
      return;
    }
    if (!("stepId" in event)) invalid("Expected step event");
    if (event.type === "step-started") {
      if (step !== undefined || steps.has(event.stepId) || messages.has(event.messageId)
        || steps.size >= CONTENT_MAX_STEPS) invalid("Duplicate, overlapping or excessive step");
      steps.add(event.stepId);
      messages.add(event.messageId);
      step = { id: event.stepId, messageId: event.messageId };
      blocks.clear();
      return;
    }
    if (step === undefined || step.id !== event.stepId || step.messageId !== event.messageId) {
      invalid("Step or message identity mismatch");
    }
    if (event.type === "step-completed") {
      if ([...blocks.values()].some(b => !b.closed || (b.toolCallId !== undefined && b.execution !== "settled"))) {
        invalid("Step has unfinished blocks or tools");
      }
      step = undefined;
      return;
    }
    if (!("blockId" in event)) invalid("Expected block event");
    if (event.type === "block-started") {
      if (blockIds.has(event.blockId) || blockIds.size >= CONTENT_MAX_BLOCKS) {
        invalid("Duplicate or excessive block");
      }
      const toolCallId = event.kind === "tool-call" ? event.toolCallId : undefined;
      if (toolCallId !== undefined) {
        if (callIds.has(toolCallId)) invalid("Duplicate toolCallId");
        callIds.add(toolCallId);
      }
      const block: BlockState = { id: event.blockId, toolCallId, chars: 0, closed: false, execution: "pending" };
      blockIds.add(event.blockId);
      blocks.set(event.blockId, block);
      return;
    }
    const block = blocks.get(event.blockId);
    if (block === undefined) invalid("Unknown block");
    if (event.type === "block-delta" || event.type === "block-completed") {
      if (block.closed) invalid("Block is not open");
      if (event.type === "block-delta") {
        block.chars += event.delta.length;
        chars += event.delta.length;
        if (block.chars > CONTENT_BLOCK_MAX_CHARS) invalid("Block text limit exceeded");
      } else {
        block.closed = true;
      }
    } else {
      if (block.toolCallId === undefined || block.toolCallId !== event.toolCallId || !block.closed) {
        invalid("Tool result association or argument completion mismatch");
      }
      if (event.type === "tool-started") {
        if (block.execution !== "pending") invalid("Tool already started or settled");
        block.execution = "running";
      } else {
        if (block.execution === "settled" || (event.status === "succeeded" && block.execution !== "running")) {
          invalid("Tool result order mismatch");
        }
        block.execution = "settled";
        chars += event.summary.length + event.detail.length;
      }
    }
    if (chars > CONTENT_TURN_MAX_CHARS) invalid("Turn content limit exceeded");
  };
  return {
    parse(value: unknown): AssistantEvent {
      if (poisoned) invalid("Validator is closed after rejection");
      try {
        const event = parseAssistantEvent(value);
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

function invalid(message: string): never {
  throw new RpcError("invalid-output", message);
}
