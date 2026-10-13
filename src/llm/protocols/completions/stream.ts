import { randomUUID } from "node:crypto";

import { createToolCallId } from "../../../brand/ids.js";
import { LLMProviderError } from "../../errors.js";
import { readSseData } from "../sse.js";
import type { ContentBlockType, FinishReason, ModelEvent, TokenUsage } from "../../types.js";

export interface ChatCompletionsStreamOptions {
  readonly errorLabel: string;
  readonly reasoningField?: "reasoning";
  readonly generatedToolCallIdPrefix: string;
}

interface OpenContent {
  readonly contentIndex: number;
  readonly remoteToolIndex?: number;
  readonly contentType: ContentBlockType;
  started: boolean;
  id?: ReturnType<typeof createToolCallId>;
  remoteId?: ReturnType<typeof createToolCallId>;
  name?: string;
}

export async function* translateChatCompletionsSse(
  body: ReadableStream<Uint8Array>,
  options: ChatCompletionsStreamOptions,
): AsyncGenerator<ModelEvent> {
  const contents: OpenContent[] = [];
  let finish: FinishReason | undefined;
  let usage: TokenUsage | undefined;
  for await (const payload of readSseData(body, options)) {
    if (payload === "[DONE]") break;
    const event = parseEvent(payload, options.errorLabel);
    usage = event.usage === undefined ? usage : parseUsage(event.usage, options.errorLabel);
    const choice = event.choices?.[0];
    if (choice === undefined) continue;
    const delta = choice.delta;
    const reasoning = options.reasoningField === undefined
      ? undefined : delta?.[options.reasoningField];
    if (typeof reasoning === "string" && reasoning.length > 0) {
      const content = ensureTextContent(contents, "reasoning");
      if (!content.started) {
        content.started = true;
        yield { type: "content-started", contentIndex: content.contentIndex, contentType: "reasoning" };
      }
      yield { type: "content-delta", contentIndex: content.contentIndex,
        contentType: "reasoning", delta: reasoning };
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
    yield* translateToolCalls(contents, delta?.tool_calls ?? [], options);
    if (choice.finish_reason !== null && choice.finish_reason !== undefined) {
      finish = mapFinishReason(choice.finish_reason, options.errorLabel);
    }
  }
  if (finish === undefined) return;
  for (const content of contents) {
    if (content.contentType === "tool-call") {
      if (finish.kind === "max-tokens" || finish.kind === "content-filter") continue;
      if (!content.started || !content.name) {
        throw invalidEvent(options.errorLabel, "tool call ended without a function name.");
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
  options: ChatCompletionsStreamOptions,
): Generator<ModelEvent> {
  for (const call of calls) {
    if (!Number.isSafeInteger(call.index) || call.index < 0) {
      throw invalidEvent(options.errorLabel, "tool call has an invalid index.");
    }
    const content = ensureToolContent(contents, call.index);
    if (typeof call.id === "string" && call.id.length > 0) {
      const remoteId = createToolCallId(call.id);
      if (content.remoteId !== undefined && content.remoteId !== remoteId) {
        throw invalidEvent(options.errorLabel, "tool call changed id.");
      }
      content.remoteId = remoteId;
    }
    if (content.id === undefined) {
      content.id = content.remoteId ?? createToolCallId(`${options.generatedToolCallIdPrefix}-${randomUUID()}`);
    }
    const name = call.function?.name;
    const delta = call.function?.arguments ?? "";
    if (typeof delta !== "string") {
      throw invalidEvent(options.errorLabel, "tool arguments delta is invalid.");
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

function parseEvent(payload: string, errorLabel: string): OpenAiStreamEvent {
  try {
    const parsed = JSON.parse(payload) as unknown;
    if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
      throw new TypeError("event is not an object");
    }
    return parsed as OpenAiStreamEvent;
  } catch (cause: unknown) {
    throw invalidEvent(errorLabel, "data is not valid JSON.", cause);
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

function mapFinishReason(value: unknown, errorLabel: string): FinishReason {
  if (value === "stop") return { kind: "stop" };
  if (value === "tool_calls") return { kind: "tool-calls" };
  if (value === "length") return { kind: "max-tokens" };
  if (value === "content_filter") return { kind: "content-filter" };
  throw invalidEvent(errorLabel, "finish reason is unsupported.");
}

function parseUsage(value: OpenAiUsage, errorLabel: string): TokenUsage {
  if (!isCount(value.prompt_tokens) || !isCount(value.completion_tokens)) {
    throw invalidEvent(errorLabel, "usage is invalid.");
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

function invalidEvent(errorLabel: string, message: string, cause?: unknown): LLMProviderError {
  return new LLMProviderError("TRANSPORT", `${errorLabel} SSE ${message}`, cause === undefined ? {} : { cause });
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
