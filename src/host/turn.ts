import type { Context } from "cordis";

import {
  AGENT_DELTA_MAX_CHARS,
} from "../../rpc/agent.js";
import type {
  AgentTurnEvent,
  AgentTurnInput,
} from "../../rpc/agent.js";
import type { RpcStreamHandler } from "../../rpc/stream.js";
import { createMessageId, createSessionId } from "../brand/ids.js";
import type { TurnModelConfig, TurnResult } from "../agent/types.js";
import { splitDelta } from "./turn/split.js";
import { StreamEventQueue } from "./turn/queue.js";
import { classifyTurnTerminal } from "./turn/terminal.js";

export interface AgentTurnHandlerConfig {
  readonly model: TurnModelConfig;
  readonly systemPrompt?: string;
}

/** Bind the public agent.turn stream to the provider-neutral AgentRuntime. */
export function createAgentTurnHandler(
  ctx: Context,
  config: AgentTurnHandlerConfig,
): RpcStreamHandler<AgentTurnInput, AgentTurnEvent> {
  return async function* agentTurn(input, signal) {
    const events = new StreamEventQueue<AgentTurnEvent>();
    let terminated = false;
    const execution = ctx.agentRuntime.runTurn({
      sessionId: createSessionId(input.sessionId),
      userMessage: {
        id: createMessageId(input.requestId),
        role: "user",
        content: [{ type: "text", text: input.text }],
      },
      model: config.model,
      ...(config.systemPrompt === undefined ? {} : { systemPrompt: config.systemPrompt }),
      toolNames: [],
      signal,
      onEvent(event) {
        if (event.type === "turn-started") {
          events.push({ type: "started", turnId: event.turnId });
          return true;
        } else if (event.type === "content-delta" && event.contentType === "text") {
          let published = false;
          for (const part of splitDelta(event.delta, AGENT_DELTA_MAX_CHARS)) {
            if (part.length > 0) {
              events.push({ type: "text-delta", text: part });
              published = true;
            }
          }
          return published;
        } else if (event.type === "turn-finished") {
          terminated = true;
          events.push(terminalEvent(event.result));
          return true;
        }
        return false;
      },
    }).then(
      () => {
        events.end();
      },
      () => {
        if (!terminated) {
          events.push({
            type: "failed",
            failure: { code: "runtime-failed", message: "Agent runtime failed.", details: {} },
          });
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

function terminalEvent(result: TurnResult): AgentTurnEvent {
  const terminal = classifyTurnTerminal(result);
  if (terminal === "completed") return { type: "completed" };
  if (terminal === "cancelled") return { type: "cancelled" };
  if (terminal === "truncated") return { type: "truncated" };
  if (!("failure" in result)) {
    return {
      type: "failed",
      failure: { code: "runtime-failed", message: "Agent runtime failed.", details: {} },
    };
  }
  return {
    type: "failed",
    failure: {
      code: result.failure.code,
      message: result.failure.message,
      details: {},
    },
  };
}
