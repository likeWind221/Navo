import type { Context } from "cordis";

import type { StepId } from "../brand/ids.js";
import type { ToolCallContentBlock } from "../llm/types.js";
import { toolResultMessage } from "./result.js";
import type { StepOutcome } from "./result.js";
import type { ModelCompletion, TurnScope } from "./types.js";

/** Persists one accepted response and dispatches its model-requested tools. */
export async function acceptResponse(
  ctx: Context,
  turn: TurnScope,
  stepId: StepId,
  response: ModelCompletion,
): Promise<StepOutcome> {
  const { input: { sessionId }, turnId, signal } = turn;
  const { message, finishReason, usage } = response;
  ctx.sessions.append({
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
    return blocked(stepId, "max-tokens", "Model output reached its token limit.");
  }
  if (finishReason.kind === "content-filter") {
    return blocked(
      stepId,
      "content-filter",
      "Model output was stopped by a content filter.",
    );
  }
  const calls = message.content.filter(
    (block): block is ToolCallContentBlock => block.type === "tool-call",
  );
  for (const toolCall of calls) {
    ctx.sessions.append({
      type: "tool-call-requested",
      sessionId,
      data: { turnId, stepId, toolCall },
    });
    const result = await ctx.tools.execute(toolCall, signal);
    ctx.sessions.append({
      type: "tool-call-result",
      sessionId,
      data: { turnId, stepId, message: toolResultMessage(result) },
    });
  }
  if (signal.aborted) return { status: "cancelled", stepId };
  return { status: calls.length === 0 ? "completed" : "continue", stepId };
}

function blocked(
  stepId: StepId,
  code: string,
  message: string,
): StepOutcome {
  return {
    status: "completed",
    turnStatus: "blocked",
    stepId,
    failure: { code, message },
  };
}
