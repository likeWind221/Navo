import type { Context } from "cordis";

import type { StepId } from "../brand/ids.js";
import type { ToolCallContentBlock } from "../llm/types.js";
import type { SessionStore } from "../session/store.js";
import {
  toolResultMessage,
  unexecutedToolResultMessage,
} from "./result.js";
import type { StepOutcome } from "./result.js";
import type { ModelCompletion, TurnScope } from "./types.js";

export async function acceptResponse(
  ctx: Context,
  turn: TurnScope,
  stepId: StepId,
  response: ModelCompletion,
): Promise<StepOutcome> {
  const { input, turnId, signal } = turn;
  const { sessionId } = input;
  const sessions = ctx.sessions;
  const tools = ctx.tools;
  const { message, finishReason, usage } = response;
  const calls = message.content.filter(
    (block): block is ToolCallContentBlock => block.type === "tool-call",
  );
  sessions.append({
    type: "assistant-message",
    sessionId,
    data: {
      turnId,
      stepId,
      message,
      finishReason,
      ...(usage === undefined ? {} : { usage }),
    },
  });
  if (finishReason.kind === "max-tokens") {
    for (const toolCall of calls) {
      appendToolCall(sessions, sessionId, turnId, stepId, toolCall);
      const message = unexecutedToolResultMessage(toolCall.id);
      sessions.append({
        type: "tool-call-result",
        sessionId,
        data: {
          turnId,
          stepId,
          message,
        },
      });
      await turn.output.rejectTool(toolCall.id, {
        code: "max-tokens",
        message: "Tool call was not executed because the model response reached its output token limit.",
      });
    }
    return blocked(stepId, "max-tokens", "Model output reached its token limit.");
  }
  if (finishReason.kind === "content-filter") {
    return blocked(
      stepId,
      "content-filter",
      "Model output was stopped by a content filter.",
    );
  }
  for (const toolCall of calls) {
    appendToolCall(sessions, sessionId, turnId, stepId, toolCall);
    const result = await tools.execute(toolCall, signal, {
      sessionId,
      allowedTools: input.toolNames,
      onStarted: async () => {
        await turn.output.toolStarted(toolCall.id);
      },
    });
    sessions.append({
      type: "tool-call-result",
      sessionId,
      data: { turnId, stepId, message: toolResultMessage(result) },
    });
    await turn.output.toolResult(result);
    if (result.kind === "failure") {
      sessions.append({
        type: "error",
        sessionId,
        data: {
          turnId,
          stepId,
          toolCallId: toolCall.id,
          source: "tool",
          failure: result.failure,
        },
      });
    }
  }
  if (signal.aborted) return { status: "cancelled", stepId };
  return { status: calls.length === 0 ? "completed" : "continue", stepId };
}

function appendToolCall(
  sessions: SessionStore,
  sessionId: TurnScope["input"]["sessionId"],
  turnId: TurnScope["turnId"],
  stepId: StepId,
  toolCall: ToolCallContentBlock,
): void {
  sessions.append({
    type: "tool-call-requested",
    sessionId,
    data: { turnId, stepId, toolCall },
  });
}

function blocked(
  stepId: StepId,
  code: string,
  message: string,
): StepOutcome {
  return {
    status: "blocked",
    stepId,
    failure: { code, message },
    failureSource: "llm",
  };
}
