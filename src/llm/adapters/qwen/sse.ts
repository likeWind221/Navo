import { randomUUID } from "node:crypto";

import { createToolCallId } from "../../../brand/ids.js";
import { LLMProviderError } from "../../errors.js";
import type { ContentBlockType, FinishReason, ModelEvent, TokenUsage } from "../../types.js";

export const QWEN_SSE_MAX_EVENT_CHARS = 1_048_576;

interface OpenContent {
  readonly contentIndex: number;
  readonly remoteToolIndex?: number;
  readonly contentType: ContentBlockType;
  started: boolean;
  id?: ReturnType<typeof createToolCallId>;
  remoteId?: ReturnType<typeof createToolCallId>;
  name?: string;
}

/** Incrementally parse SSE and translate Qwen deltas into canonical model events. */
export async function* translateQwenSse(
  body: ReadableStream<Uint8Array>,
): AsyncGenerator<ModelEvent> {
  const contents: OpenContent[] = [];
  let finish: FinishReason | undefined;
  let usage: TokenUsage | undefined;
  for await (const payload of readSseData(body)) {
    if (payload === "[DONE]") break;
    const event = parseEvent(payload);
    usage = event.usage === undefined ? usage : parseUsage(event.usage);
    const choice = event.choices?.[0];
    if (choice === undefined) continue;
    const delta = choice.delta;
    if (typeof delta?.reasoning === "string" && delta.reasoning.length > 0) {
      const content = ensureTextContent(contents, "reasoning");
      if (!content.started) {
        content.started = true;
        yield { type: "content-started", contentIndex: content.contentIndex, contentType: "reasoning" };
      }
      yield { type: "content-delta", contentIndex: content.contentIndex,
        contentType: "reasoning", delta: delta.reasoning };
    }
    if (typeof delta?.content === "string" && delta.content.length > 0) {
      const content = ensureTextContent(contents, "text");
      if (!content.started) {
        content.started = true;
        yield { type: "content-started", contentIndex: content.contentIndex, contentType: "text" };
      }
      yield { type: "content-delta", contentIndex: content.contentIndex,
        contentType: "text", delta: delta.content };
    }
    yield* translateToolCalls(contents, delta?.tool_calls ?? []);
    if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
      finish = mapFinishReason(choice.finish_reason);
    }
  }
  if (finish === undefined) return;
  for (const content of contents) {
    if (content.contentType === "tool-call") {
      if (finish.kind === "max-tokens" || finish.kind === "content-filter") continue;
      if (!content.started || !content.name) {
        throw invalidEvent("Qwen SSE tool call ended without a function name.");
      }
    }
    if (!content.started) continue;
    yield { type: "content-completed", contentIndex: content.contentIndex,
      contentType: content.contentType };
  }
  if (usage !== undefined) yield { type: "usage", usage };
  yield { type: "finished", reason: finish };
}

function* translateToolCalls(
  contents: OpenContent[],
  calls: readonly OpenAiToolCallDelta[],
): Generator<ModelEvent> {
  for (const call of calls) {
    if (!Number.isSafeInteger(call.index) || call.index < 0) {
      throw invalidEvent("Qwen SSE tool call has an invalid index.");
    }
    const content = ensureToolContent(contents, call.index);
    if (typeof call.id === "string" && call.id.length > 0) {
      const remoteId = createToolCallId(call.id);
      if (content.remoteId !== undefined && content.remoteId !== remoteId) {
        throw invalidEvent("Qwen SSE tool call changed id.");
      }
      content.remoteId = remoteId;
    }
    if (content.id === undefined) {
      content.id = content.remoteId ?? createToolCallId(`qwen-generated-${randomUUID()}`);
    }
    const name = call.function?.name;
    const delta = call.function?.arguments ?? "";
    if (typeof delta !== "string") {
      throw invalidEvent("Qwen SSE tool arguments delta is invalid.");
    }
    if (typeof name === "string") content.name = `${content.name ?? ""}${name}`;
    if (!content.started) {
      content.started = true;
      yield { type: "content-started", contentIndex: content.contentIndex,
        contentType: "tool-call", toolCallId: content.id };
    }
    yield {
      type: "content-delta",
      contentIndex: content.contentIndex,
      contentType: "tool-call",
      toolCallId: content.id,
      ...(typeof name === "string" && name.length > 0 ? { toolNameDelta: name } : {}),
      delta,
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

function ensureTextContent(
  contents: OpenContent[],
  contentType: "text" | "reasoning",
): OpenContent {
  let content = contents.find((candidate) => candidate.contentType === contentType);
  if (content === undefined) {
    content = { contentIndex: contents.length, contentType, started: false };
    contents.push(content);
  }
  return content;
}

function ensureToolContent(contents: OpenContent[], remoteIndex: number): OpenContent {
  let content = contents.find((candidate) =>
    candidate.contentType === "tool-call" && candidate.remoteToolIndex === remoteIndex);
  if (content === undefined) {
    content = { contentIndex: contents.length, remoteToolIndex: remoteIndex,
      contentType: "tool-call", started: false };
    contents.push(content);
  }
  return content;
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
    readonly reasoning?: unknown;
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
