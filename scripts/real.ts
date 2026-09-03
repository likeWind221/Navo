import { Context } from "cordis";

import {
  createMessageId,
  createSessionId,
  createToolCallId,
} from "../src/brand/ids.js";
import { AgentRuntime } from "../src/agent/runtime.js";
import type { LLMAdapter } from "../src/llm/service.js";
import { LLMService } from "../src/llm/service.js";
import type {
  GenerateRequest,
  StreamChunk,
  ToolCallContentBlock,
} from "../src/llm/types.js";
import { SessionStore } from "../src/session/store.js";
import { ToolService } from "../src/tools/service.js";

const baseUrl = (process.env.LLM_BASE_URL ?? "http://192.168.99.2:8090/v1")
  .replace(/\/$/, "");
const model = process.env.LLM_MODEL ?? "qwen3.8-27b";
const apiKey = process.env.LLM_API_KEY;

async function main(): Promise<void> {
  const ctx = new Context();
  try {
    await ctx.plugin(SessionStore);
    await ctx.plugin(LLMService);
    await ctx.plugin(ToolService);
    await ctx.plugin(AgentRuntime);
    ctx.llm.registerAdapter("real", new OpenAIStreamingAdapter(baseUrl, apiKey));
    ctx.tools.register({
      name: "echo_for_real_test",
      description: "Returns its text argument unchanged.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
        additionalProperties: false,
      },
      execute: async (arguments_) => String(arguments_.text),
    });

    const sessionId = createSessionId("real-agent-step");
    const result = await ctx.agentRuntime.runTurn({
      sessionId,
      userMessage: {
        id: createMessageId("real-agent-user"),
        role: "user",
        content: [{
          type: "text",
          text: "Call echo_for_real_test exactly once with text 'real-loop', then use its result to answer exactly: FINAL: real-loop",
        }],
      },
      model: { provider: "real", model },
    });
    if (result.status !== "completed" || result.steps !== 2) {
      throw new Error(`Expected a completed two-Step Turn; received ${JSON.stringify(result)}.`);
    }
    const text = ctx.sessions.getEvents(sessionId).flatMap((event) =>
      event.type === "assistant-message"
        ? event.data.message.content.filter((block) => block.type === "text")
        : [],
    ).at(-1)?.text ?? "";
    if (text.trim() !== "FINAL: real-loop") {
      throw new Error(`Unexpected final answer: ${JSON.stringify(text)}`);
    }
    console.log("Real two-Step AgentRuntime Turn passed.");
    console.log(ctx.sessions.getEvents(sessionId).map((event) => event.type).join(" → "));
  } finally {
    await ctx.fiber.dispose();
  }
}

class OpenAIStreamingAdapter implements LLMAdapter {
  constructor(
    private readonly endpoint: string,
    private readonly apiKey: string | undefined,
  ) {}

  async *stream(request: GenerateRequest): AsyncGenerator<StreamChunk> {
    const response = await fetch(`${this.endpoint}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(this.apiKey === undefined ? {} : { authorization: `Bearer ${this.apiKey}` }),
      },
      body: JSON.stringify({
        model: request.model,
        messages: request.messages.map(toOpenAIMessage),
        ...(request.tools === undefined ? {} : { tools: request.tools.map((tool) => ({
          type: "function",
          function: tool,
        })) }),
        ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
        ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
        stream: true,
      }),
      signal: request.signal,
    });
    if (!response.ok || response.body === null) {
      throw new Error(`LLM request failed: HTTP ${response.status} ${await response.text()}`);
    }

    const blocks: CollectedBlock[] = [];
    let finish = "stop";
    for await (const payload of ssePayloads(response.body)) {
      if (payload === "[DONE]") break;
      const event = JSON.parse(payload) as OpenAIStreamEvent;
      const choice = event.choices[0];
      if (!choice) continue;
      if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
        finish = choice.finish_reason;
      }
      collectDelta(blocks, choice.delta);
    }
    for (const [index, block] of blocks.entries()) {
      yield { type: "block-start", index, blockType: block.type };
      if (block.type === "text") yield { type: "text-delta", index, text: block.text };
      if (block.type === "reasoning") yield { type: "reasoning-delta", index, text: block.text };
      if (block.type === "tool-call") {
        yield { type: "tool-call-delta", index, id: block.id, name: block.name, argumentsDelta: block.arguments };
      }
      yield { type: "block-end", index, block };
    }
    yield { type: "finish", reason: finishReason(finish) };
  }
}

function toOpenAIMessage(message: GenerateRequest["messages"][number]): object {
  const toolResult = message.content.find((block) => block.type === "tool-result");
  if (toolResult?.type === "tool-result") {
    return { role: "tool", tool_call_id: toolResult.toolCallId, content: textOf(toolResult.content) };
  }
  const toolCalls = message.content.filter((block) => block.type === "tool-call");
  return {
    role: message.role,
    content: textOf(message.content),
    ...(toolCalls.length === 0 ? {} : { tool_calls: toolCalls.map((call) => ({
      id: call.id,
      type: "function",
      function: { name: call.name, arguments: call.arguments },
    })) }),
  };
}

function textOf(blocks: readonly { readonly type: string; readonly text?: string }[]): string {
  return blocks.filter((block) => block.type === "text").map((block) => block.text ?? "").join("");
}

async function* ssePayloads(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const next = await reader.read();
    if (next.done) break;
    buffer += decoder.decode(next.value, { stream: true });
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = events.pop() ?? "";
    for (const event of events) {
      const payload = event.split(/\r?\n/)
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart()).join("\n");
      if (payload) yield payload;
    }
  }
}

function collectDelta(blocks: CollectedBlock[], delta: OpenAIStreamEvent["choices"][number]["delta"]): void {
  if (delta.reasoning_content) appendText(blocks, "reasoning", delta.reasoning_content);
  if (delta.content) appendText(blocks, "text", delta.content);
  for (const call of delta.tool_calls ?? []) {
    let block = blocks.find((candidate) => candidate.type === "tool-call" && candidate.remoteIndex === call.index);
    if (!block) {
      block = { type: "tool-call", remoteIndex: call.index, id: createToolCallId(call.id ?? `call-${call.index}`), name: "", arguments: "" };
      blocks.push(block);
    }
    if (call.id) block.id = createToolCallId(call.id);
    if (call.function?.name) block.name += call.function.name;
    if (call.function?.arguments) block.arguments += call.function.arguments;
  }
}

function appendText(blocks: CollectedBlock[], type: "text" | "reasoning", text: string): void {
  const last = blocks.at(-1);
  if (last?.type === type) last.text += text;
  else blocks.push({ type, text });
}

function finishReason(value: string): StreamChunk extends { type: "finish"; reason: infer TReason } ? TReason : never {
  if (value === "tool_calls") return { kind: "tool-calls" };
  if (value === "length") return { kind: "max-tokens" };
  if (value === "content_filter") return { kind: "content-filter" };
  return { kind: "stop" };
}

type CollectedBlock =
  | { type: "text"; text: string }
  | { type: "reasoning"; text: string }
  | (ToolCallContentBlock & { remoteIndex: number });

interface OpenAIStreamEvent {
  readonly choices: readonly [{
    readonly delta: {
      readonly content?: string;
      readonly reasoning_content?: string;
      readonly tool_calls?: readonly {
        readonly index: number;
        readonly id?: string;
        readonly function?: { readonly name?: string; readonly arguments?: string };
      }[];
    };
    readonly finish_reason?: string | null;
  }];
}

void main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
