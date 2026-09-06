import { createToolCallId } from "../brand/ids.js";
import { LLMProviderError } from "./errors.js";
import type { FinishReason, StreamChunk, StreamContentBlock, TokenUsage } from "./types.js";

export const QWEN_SSE_MAX_EVENT_CHARS = 1_048_576;

interface OpenBlock {
  readonly index: number;
  readonly remoteToolIndex?: number;
  readonly type: StreamContentBlock["type"];
  text: string;
  id?: ReturnType<typeof createToolCallId>;
  name?: string;
}

/** Incrementally parse SSE and translate Qwen deltas into canonical chunks. */
export async function* translateQwenSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<StreamChunk> {
  const blocks: OpenBlock[] = [];
  let finish: FinishReason | undefined;
  let usage: TokenUsage | undefined;
  for await (const payload of readSseData(body)) {
    if (payload === "[DONE]") break;
    const event = parseEvent(payload);
    usage = event.usage === undefined ? usage : parseUsage(event.usage);
    const choice = event.choices?.[0];
    if (choice === undefined) continue;
    const delta = choice.delta;
    if (typeof delta?.reasoning_content === "string" && delta.reasoning_content.length > 0) {
      const block = ensureTextBlock(blocks, "reasoning");
      if (block.text.length === 0) yield { type: "block-start", index: block.index, blockType: "reasoning" };
      block.text += delta.reasoning_content;
      yield { type: "reasoning-delta", index: block.index, text: delta.reasoning_content };
    }
    if (typeof delta?.content === "string" && delta.content.length > 0) {
      const block = ensureTextBlock(blocks, "text");
      if (block.text.length === 0) yield { type: "block-start", index: block.index, blockType: "text" };
      block.text += delta.content;
      yield { type: "text-delta", index: block.index, text: delta.content };
    }
    yield* translateToolCalls(blocks, delta?.tool_calls ?? []);
    if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
      finish = mapFinishReason(choice.finish_reason);
    }
  }
  if (finish === undefined) return;
  for (const block of blocks) {
    yield { type: "block-end", index: block.index, block: completeBlock(block) };
  }
  if (usage !== undefined) yield { type: "usage", usage };
  yield { type: "finish", reason: finish };
}

function* translateToolCalls(
  blocks: OpenBlock[],
  calls: readonly OpenAiToolCallDelta[],
): Generator<StreamChunk> {
  for (const call of calls) {
    if (!Number.isSafeInteger(call.index) || call.index < 0) {
      throw invalidEvent("Qwen SSE tool call has an invalid index.");
    }
    const block = ensureToolBlock(blocks, call.index);
    const first = block.id === undefined;
    if (typeof call.id === "string" && call.id.length > 0) block.id = createToolCallId(call.id);
    if (block.id === undefined) block.id = createToolCallId(`qwen-call-${call.index}`);
    if (first) yield { type: "block-start", index: block.index, blockType: "tool-call" };
    const name = call.function?.name;
    const argumentsDelta = call.function?.arguments ?? "";
    if (typeof name === "string") block.name = `${block.name ?? ""}${name}`;
    if (typeof argumentsDelta !== "string") {
      throw invalidEvent("Qwen SSE tool arguments delta is invalid.");
    }
    block.text += argumentsDelta;
    yield {
      type: "tool-call-delta",
      index: block.index,
      id: block.id,
      ...(typeof name === "string" && name.length > 0 ? { name } : {}),
      argumentsDelta,
    };
  }
}

async function* readSseData(body: ReadableStream<Uint8Array>): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let exhausted = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        exhausted = true;
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(next.value, { stream: true });
      const split = takeEvents(buffer);
      buffer = split.rest;
      assertEventSize(buffer.length);
      for (const payload of split.payloads) yield payload;
    }
    if (buffer.trim().length > 0) {
      assertEventSize(buffer.length);
      const payload = eventData(buffer);
      if (payload.length > 0) yield payload;
    }
  } catch (cause: unknown) {
    if (cause instanceof LLMProviderError) throw cause;
    throw invalidEvent("Qwen SSE stream is invalid.", cause);
  } finally {
    if (!exhausted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function takeEvents(buffer: string): { readonly payloads: string[]; readonly rest: string } {
  const payloads: string[] = [];
  let rest = buffer;
  while (true) {
    const match = /\r?\n\r?\n/.exec(rest);
    if (match === null) return { payloads, rest };
    assertEventSize(match.index);
    const raw = rest.slice(0, match.index);
    rest = rest.slice(match.index + match[0].length);
    const payload = eventData(raw);
    if (payload.length > 0) payloads.push(payload);
  }
}

function assertEventSize(characters: number): void {
  if (characters > QWEN_SSE_MAX_EVENT_CHARS) {
    throw invalidEvent("Qwen SSE event exceeds the size limit.");
  }
}

function eventData(raw: string): string {
  return raw.split(/\r?\n/)
    .filter((line) => line === "data" || line.startsWith("data:"))
    .map((line) => line === "data" ? "" : line.slice(5).replace(/^ /, ""))
    .join("\n");
}

function parseEvent(payload: string): OpenAiStreamEvent {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new TypeError("event is not an object");
    }
    return parsed as OpenAiStreamEvent;
  } catch (cause: unknown) {
    throw invalidEvent("Qwen SSE data is not valid JSON.", cause);
  }
}

function ensureTextBlock(blocks: OpenBlock[], type: "text" | "reasoning"): OpenBlock {
  let block = blocks.find((candidate) => candidate.type === type);
  if (block === undefined) {
    block = { index: blocks.length, type, text: "" };
    blocks.push(block);
  }
  return block;
}

function ensureToolBlock(blocks: OpenBlock[], remoteIndex: number): OpenBlock {
  let block = blocks.find((candidate) =>
    candidate.type === "tool-call" && candidate.remoteToolIndex === remoteIndex);
  if (block === undefined) {
    block = { index: blocks.length, remoteToolIndex: remoteIndex, type: "tool-call", text: "" };
    blocks.push(block);
  }
  return block;
}

function completeBlock(block: OpenBlock): StreamContentBlock {
  if (block.type === "text" || block.type === "reasoning") return { type: block.type, text: block.text };
  if (block.id === undefined || !block.name) {
    throw invalidEvent("Qwen SSE tool call ended without an id or function name.");
  }
  return { type: "tool-call", id: block.id, name: block.name, arguments: block.text };
}

function mapFinishReason(value: unknown): FinishReason {
  if (value === "stop") return { kind: "stop" };
  if (value === "tool_calls") return { kind: "tool-calls" };
  if (value === "length") return { kind: "max-tokens" };
  if (value === "content_filter") return { kind: "content-filter" };
  throw invalidEvent("Qwen SSE finish reason is unsupported.");
}

function parseUsage(value: OpenAiUsage): TokenUsage {
  if (!isCount(value.prompt_tokens) || !isCount(value.completion_tokens)) {
    throw invalidEvent("Qwen SSE usage is invalid.");
  }
  return {
    inputTokens: value.prompt_tokens,
    outputTokens: value.completion_tokens,
    ...(isCount(value.total_tokens) ? { totalTokens: value.total_tokens } : {}),
    ...(isCount(value.completion_tokens_details?.reasoning_tokens)
      ? { reasoningTokens: value.completion_tokens_details.reasoning_tokens } : {}),
  };
}

function isCount(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0;
}

function invalidEvent(message: string, cause?: unknown): LLMProviderError {
  return new LLMProviderError("TRANSPORT", message, cause === undefined ? {} : { cause });
}

interface OpenAiStreamEvent {
  readonly choices?: readonly OpenAiChoice[];
  readonly usage?: OpenAiUsage;
}

interface OpenAiChoice {
  readonly delta?: {
    readonly content?: unknown;
    readonly reasoning_content?: unknown;
    readonly tool_calls?: readonly OpenAiToolCallDelta[];
  };
  readonly finish_reason?: unknown;
}

interface OpenAiToolCallDelta {
  readonly index: number;
  readonly id?: string;
  readonly function?: { readonly name?: string; readonly arguments?: unknown };
}

interface OpenAiUsage {
  readonly prompt_tokens?: unknown;
  readonly completion_tokens?: unknown;
  readonly total_tokens?: unknown;
  readonly completion_tokens_details?: { readonly reasoning_tokens?: unknown };
}
