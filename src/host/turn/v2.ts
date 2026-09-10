import type { Context } from "cordis";

import type { AgentTurnV2Event } from "../../../rpc/content.js";
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

export interface AgentTurnV2HandlerConfig {
  readonly model: TurnModelConfig;
  readonly systemPrompt?: string;
  readonly toolNames?: readonly string[];
}

export function createAgentTurnV2Handler(
  ctx: Context,
  config: AgentTurnV2HandlerConfig,
): RpcStreamHandler<AgentTurnInput, AgentTurnV2Event> {
  return async function* agentTurnV2(input, signal) {
    const events = new StreamEventQueue<AgentTurnV2Event>();
    const controller = new AbortController();
    const execution = ctx.agentRuntime.runTurn({
      sessionId: createSessionId(input.sessionId),
      requestId: input.requestId,
      userMessage: {
        id: createMessageId(input.requestId),
        role: "user",
        content: [{ type: "text", text: input.text }],
      },
      model: config.model,
      ...(config.systemPrompt === undefined
        ? {} : { systemPrompt: config.systemPrompt }),
      ...(config.toolNames === undefined ? {} : { toolNames: config.toolNames }),
      signal: AbortSignal.any([signal, controller.signal]),
      onEvent(event) {
        if ("commandId" in event) return false;
        events.push(event);
        return true;
      },
    }).then(
      () => events.end(),
      error => events.fail(error),
    );
    try {
      for await (const event of events) yield event;
    } finally {
      controller.abort();
      await execution;
    }
  };
}
