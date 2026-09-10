import type { Context } from "cordis";
import type { AgentTurnEvent, AgentTurnInput } from "../../rpc/agent.js";
import type { RpcStreamHandler } from "../../rpc/stream.js";
import type { TurnLifecycleEvent } from "../../shared/content.js";
import { createMessageId, createSessionId } from "../brand/ids.js";
import type { TurnModelConfig } from "../agent/types.js";
import { StreamEventQueue } from "./turn/queue.js";

export interface AgentTurnHandlerConfig {
  readonly model: TurnModelConfig;
  readonly systemPrompt?: string;
  readonly toolNames?: readonly string[];
}

export function createAgentTurnHandler(
  ctx: Context,
  config: AgentTurnHandlerConfig,
): RpcStreamHandler<AgentTurnInput, AgentTurnEvent> {
  return async function* agentTurn(input, signal) {
    const events = new StreamEventQueue<AgentTurnEvent>();
    const textContents = new Set<number>();
    let terminated = false;
    const execution = ctx.agentRuntime.runTurn({
      sessionId: createSessionId(input.sessionId),
      requestId: input.requestId,
      userMessage: {
        id: createMessageId(input.requestId),
        role: "user",
        content: [{ type: "text", text: input.text }],
      },
      model: config.model,
      ...(config.systemPrompt === undefined ? {} : { systemPrompt: config.systemPrompt }),
      ...(config.toolNames === undefined ? {} : { toolNames: config.toolNames }),
      signal,
      onEvent(event) {
        if (event.type === "turn-started") {
          events.push({ type: "started", turnId: event.turnId });
          return true;
        }
        if (event.type === "step-started") textContents.clear();
        if (event.type === "content-started") {
          if (event.kind === "text") textContents.add(event.contentIndex);
          else textContents.delete(event.contentIndex);
        }
        if (event.type === "content-delta" && textContents.has(event.contentIndex)) {
          events.push({ type: "text-delta", text: event.delta });
          return true;
        }
        if (event.type === "turn-completed" || event.type === "turn-cancelled"
          || event.type === "turn-truncated" || event.type === "turn-failed") {
          terminated = true;
          events.push(terminalEvent(event));
          return true;
        }
        return false;
      },
    }).then(
      () => events.end(),
      () => {
        if (!terminated) {
          events.push({ type: "failed", failure: {
            code: "runtime-failed", message: "Agent runtime failed.", details: {},
          } });
        }
        events.end();
      },
    );
    try {
      for await (const event of events) yield event;
    } finally {
      await execution;
    }
  };
}

function terminalEvent(event: Exclude<TurnLifecycleEvent, { type: "turn-started" }>): AgentTurnEvent {
  if (event.type === "turn-completed") return { type: "completed" };
  if (event.type === "turn-cancelled") return { type: "cancelled" };
  if (event.type === "turn-truncated") return { type: "truncated" };
  if (event.type === "turn-failed") {
    return { type: "failed", failure: { ...event.failure, details: {} } };
  }
  throw new Error("Invalid turn terminal.");
}
