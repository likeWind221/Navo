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
    const events = new EventQueue<AgentTurnEvent>();
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
      observer: {
        onStarted(turnId) {
          events.push({ type: "started", turnId });
        },
        onTextDelta(text) {
          for (const part of splitDelta(text)) {
            events.push({ type: "text-delta", text: part });
          }
        },
      },
    }).then(
      (result) => {
        events.push(terminalEvent(result));
        events.end();
      },
      () => {
        events.push({
          type: "failed",
          failure: { code: "runtime-failed", message: "Agent runtime failed.", details: {} },
        });
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
  if (result.status === "completed") return { type: "completed" };
  if (result.status === "cancelled") return { type: "cancelled" };
  if (result.status === "blocked" && result.failure.code === "max-tokens") {
    return { type: "truncated" };
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

function splitDelta(value: string): readonly string[] {
  if (value.length <= AGENT_DELTA_MAX_CHARS) return [value];
  const parts: string[] = [];
  let offset = 0;
  while (offset < value.length) {
    let end = Math.min(offset + AGENT_DELTA_MAX_CHARS, value.length);
    if (end < value.length && isHighSurrogate(value.charCodeAt(end - 1))) end -= 1;
    parts.push(value.slice(offset, end));
    offset = end;
  }
  return parts;
}

function isHighSurrogate(value: number): boolean {
  return value >= 0xd800 && value <= 0xdbff;
}

class EventQueue<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];
  private ended = false;

  push(value: T): void {
    if (this.ended) return;
    const waiter = this.waiters.shift();
    if (waiter === undefined) this.values.push(value);
    else waiter({ done: false, value });
  }

  end(): void {
    if (this.ended) return;
    this.ended = true;
    for (const waiter of this.waiters.splice(0)) {
      waiter({ done: true, value: undefined });
    }
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      const value = this.values.shift();
      if (value !== undefined) yield value;
      else if (this.ended) return;
      else {
        const next = await new Promise<IteratorResult<T>>((resolve) => {
          this.waiters.push(resolve);
        });
        if (next.done) return;
        yield next.value;
      }
    }
  }
}
