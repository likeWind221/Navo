import type { Context } from "cordis";

import type { TurnEvent as RpcTurnEvent } from "../../../rpc/content.js";
import type { RpcStreamHandler } from "../../../rpc/stream.js";
import type { AgentTurnInput } from "../../../rpc/agent.js";
import {
  createMessageId,
  createSessionId,
} from "../../brand/ids.js";
import type {
  TurnModelConfig,
} from "../../agent/types.js";
import { StreamEventQueue } from "./queue.js";
import { V2Output } from "./v2/output.js";

export interface AgentTurnV2HandlerConfig {
  readonly model: TurnModelConfig;
  readonly systemPrompt?: string;
}

/**
 * Binds the public agent.turn.v2 stream to the provider-neutral AgentRuntime.
 * The Runtime stays RPC-agnostic; this handler is the single place that
 * translates its live TurnEvents into the public v2 stream contract,
 * including the character-budget guards that keep every emitted frame valid.
 */
export function createAgentTurnV2Handler(
  ctx: Context,
  config: AgentTurnV2HandlerConfig,
): RpcStreamHandler<AgentTurnInput, RpcTurnEvent> {
  return async function* agentTurnV2(input, signal) {
    const events = new StreamEventQueue<RpcTurnEvent>();
    const output = new V2Output(events, input.sessionId, input.requestId);
    // The v2 stream carries no tool execution events (F3.2.2), so the model
    // is asked with an empty tool list, matching the current v1 default.
    const execution = ctx.agentRuntime.runTurn({
      sessionId: createSessionId(input.sessionId),
      userMessage: {
        id: createMessageId(input.requestId),
        role: "user",
        content: [{ type: "text", text: input.text }],
      },
      model: config.model,
      ...(config.systemPrompt === undefined
        ? {} : { systemPrompt: config.systemPrompt }),
      toolNames: [],
      signal,
      onEvent(event) {
        return output.write(event);
      },
    }).then(
      () => {
        events.end();
      },
      () => {
        output.fail();
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
