import { readSseData } from "../sse.js";
import type { FinishReason, ModelEvent, TokenUsage } from "../../types.js";
import { createResponsesReplay } from "./replay.js";
import {
  completeTool,
  appendTextPart,
  itemArguments,
  itemSummary,
  itemVisibleParts,
  reconcileArguments,
  reconcileSummary,
  reconcileTextPart,
  replayItems,
  type ResponsesItemState,
  stateFor,
  toolId,
  upsertItem,
} from "./item.js";
import {
  arrayValue,
  count,
  invalidEvent,
  objectValue,
  parseEvent,
  requiredIndex,
  requiredObject,
  requiredString,
  stringValue,
} from "./event.js";

export interface ResponsesStreamOptions {
  readonly provider: string;
  readonly model: string;
  readonly toolNamespace: string;
}

export async function* translateResponsesSse(
  body: ReadableStream<Uint8Array>,
  options: ResponsesStreamOptions,
): AsyncGenerator<ModelEvent> {
  const items = new Map<number, ResponsesItemState>();
  let usage: TokenUsage | undefined;
  let terminal: FinishReason | undefined;
  let terminalReplay: ReturnType<typeof createResponsesReplay> | undefined;
  for await (const payload of readSseData(body, { errorLabel: "Responses" })) {
    const event = parseEvent(payload);
    const type = stringValue(event.type);
    if (type === "response.output_item.added") {
      const state = upsertItem(items, requiredIndex(event.output_index), requiredObject(event.item));
      if (state.contentType === "tool-call") yield* startTool(state, options);
      continue;
    }
    if (type === "response.output_item.done") {
      const item = requiredObject(event.item);
      const state = upsertItem(items, requiredIndex(event.output_index), item);
      yield* reconcileItem(state, item, options);
      state.itemDone = true;
      if (state.contentType === "tool-call" && completeTool(state) && !state.started) {
        yield* startTool(state, options);
      }
      continue;
    }
    if (type === "response.output_text.delta") {
      const state = stateFor(items, requiredIndex(event.output_index), "text");
      const delta = requiredString(event.delta);
      const visible = appendTextPart(state, optionalIndex(event.content_index), delta);
      yield* textDelta(state, visible);
      continue;
    }
    if (type === "response.output_text.done") {
      const state = stateFor(items, requiredIndex(event.output_index), "text");
      const text = requiredString(event.text);
      const delta = reconcileTextPart(state, optionalIndex(event.content_index), text);
      if (delta.length > 0) yield* textDelta(state, delta);
      continue;
    }
    if (type === "response.reasoning_summary_text.delta") {
      const state = stateFor(items, requiredIndex(event.output_index), "reasoning");
      const delta = requiredString(event.delta);
      const index = optionalIndex(event.summary_index);
      const current = state.summaries.get(index) ?? "";
      const next = current + delta;
      const visible = reconcileSummary(state, index, next);
      yield* reasoningDelta(state, visible);
      continue;
    }
    if (type === "response.reasoning_summary_text.done") {
      const state = stateFor(items, requiredIndex(event.output_index), "reasoning");
      const index = optionalIndex(event.summary_index);
      const delta = reconcileSummary(state, index, requiredString(event.text));
      if (delta.length > 0) yield* reasoningDelta(state, delta);
      continue;
    }
    if (type === "response.refusal.delta") {
      const state = stateFor(items, requiredIndex(event.output_index), "text");
      const delta = requiredString(event.delta);
      const visible = appendTextPart(state, optionalIndex(event.content_index), delta);
      yield* textDelta(state, visible);
      continue;
    }
    if (type === "response.refusal.done") {
      const state = stateFor(items, requiredIndex(event.output_index), "text");
      const delta = reconcileTextPart(state, optionalIndex(event.content_index),
        requiredString(event.refusal));
      if (delta.length > 0) yield* textDelta(state, delta);
      continue;
    }
    if (type === "response.function_call_arguments.delta") {
      const state = stateFor(items, requiredIndex(event.output_index), "tool-call");
      const delta = requiredString(event.delta);
      state.arguments += delta;
      if (!state.started) yield* startTool(state, options);
      yield { type: "content-delta", contentIndex: state.outputIndex,
        contentType: "tool-call", toolCallId: toolId(state), delta };
      continue;
    }
    if (type === "response.function_call_arguments.done") {
      const state = stateFor(items, requiredIndex(event.output_index), "tool-call");
      const delta = reconcileArguments(state, requiredString(event.arguments));
      if (delta.length > 0) {
        if (!state.started) yield* startTool(state, options);
        yield { type: "content-delta", contentIndex: state.outputIndex,
          contentType: "tool-call", toolCallId: toolId(state), delta };
      }
      continue;
    }
    if (type === "response.completed") {
      const response = requiredObject(event.response);
      const output = arrayValue(response.output);
      if (output !== undefined) {
        for (const [index, value] of output.entries()) {
          const item = requiredObject(value);
          const state = upsertItem(items, index, item);
          yield* reconcileItem(state, item, options);
        }
      }
      usage = responseUsage(response);
      const functionCalls = [...items.values()].filter((item) => item.contentType === "tool-call");
      if (functionCalls.some((item) => !completeTool(item))) {
        terminal = errorReason("INCOMPLETE_TOOL", "Responses function call was incomplete.");
      } else {
        for (const state of items.values()) yield* completeItem(state);
        terminalReplay = createResponsesReplay(options.provider, options.model,
          replayItems(items));
        terminal = { kind: functionCalls.length === 0 ? "stop" : "tool-calls" };
      }
      break;
    }
    if (type === "response.failed") {
      terminal = failureReason(event.response);
      break;
    }
    if (type === "response.incomplete") {
      terminal = failureReason(event.response, "INCOMPLETE");
      break;
    }
    if (type === "error") {
      terminal = failureReason(event, "ERROR");
      break;
    }
  }
  if (terminal === undefined) throw invalidEvent("stream ended without a terminal response event.");
  if (usage !== undefined) yield { type: "usage", usage };
  yield {
    type: "finished",
    reason: terminal,
    ...(terminalReplay === undefined ? {} : { replay: terminalReplay }),
  };
}

function* startTool(
  state: ResponsesItemState,
  options: ResponsesStreamOptions,
): Generator<ModelEvent> {
  validateTool(state, options);
  if (state.started) return;
  state.started = true;
  yield { type: "content-started", contentIndex: state.outputIndex,
    contentType: "tool-call", toolCallId: toolId(state) };
  yield { type: "content-delta", contentIndex: state.outputIndex,
    contentType: "tool-call", toolCallId: toolId(state),
    ...(state.name === undefined ? {} : { toolNameDelta: state.name }), delta: "" };
}

function* reconcileItem(
  state: ResponsesItemState,
  item: ReturnType<typeof requiredObject>,
  options: ResponsesStreamOptions,
): Generator<ModelEvent> {
  if (state.contentType === "tool-call") {
    validateTool(state, options);
    const value = itemArguments(item);
    if (value !== undefined) {
      const delta = reconcileArguments(state, value);
      if (delta.length > 0) {
        if (!state.started) yield* startTool(state, options);
        yield { type: "content-delta", contentIndex: state.outputIndex,
          contentType: "tool-call", toolCallId: toolId(state), delta };
      }
    }
    return;
  }
  if (state.contentType !== "text" && state.contentType !== "reasoning") return;
  if (state.contentType === "text") {
    const parts = itemVisibleParts(item);
    if (parts === undefined) return;
    for (const part of parts) {
      const delta = reconcileTextPart(state, part.index, part.text);
      if (delta.length > 0) yield* textDelta(state, delta);
    }
    return;
  }
  const summary = itemSummary(item);
  if (summary === undefined) return;
  for (const [index, value] of summary.entries()) {
    const delta = reconcileSummary(state, index, value);
    if (delta.length > 0) yield* reasoningDelta(state, delta);
  }
}

function* textDelta(state: ResponsesItemState, delta: string): Generator<ModelEvent> {
  if (delta.length === 0) return;
  if (!state.started) {
    state.started = true;
    yield { type: "content-started", contentIndex: state.outputIndex, contentType: "text" };
  }
  if (delta.length > 0) {
    yield { type: "content-delta", contentIndex: state.outputIndex,
      contentType: "text", delta };
  }
}

function* reasoningDelta(state: ResponsesItemState, delta: string): Generator<ModelEvent> {
  if (delta.length === 0) return;
  if (!state.started) {
    state.started = true;
    yield { type: "content-started", contentIndex: state.outputIndex, contentType: "reasoning" };
  }
  if (delta.length > 0) {
    yield { type: "content-delta", contentIndex: state.outputIndex,
      contentType: "reasoning", delta };
  }
}

function* completeItem(state: ResponsesItemState): Generator<ModelEvent> {
  if (!state.started || state.contentDone || state.contentType === undefined) return;
  state.contentDone = true;
  yield { type: "content-completed", contentIndex: state.outputIndex,
    contentType: state.contentType };
}

function validateTool(state: ResponsesItemState, options: ResponsesStreamOptions): void {
  if (state.callId === undefined || state.name === undefined || state.name.length === 0) {
    throw invalidEvent("function call identity is incomplete.");
  }
  if (state.namespace !== options.toolNamespace) {
    throw invalidEvent("function call namespace does not match the request.");
  }
}

function optionalIndex(value: unknown): number {
  return value === undefined ? 0 : requiredIndex(value);
}

function responseUsage(response: ReturnType<typeof requiredObject>): TokenUsage | undefined {
  const usage = objectValue(response.usage);
  if (usage === undefined) return undefined;
  const input = count(usage.input_tokens);
  const output = count(usage.output_tokens);
  const total = count(usage.total_tokens);
  const reasoning = count(objectValue(usage.output_tokens_details)?.reasoning_tokens);
  if (input === undefined || output === undefined) throw invalidEvent("usage is invalid.");
  return {
    inputTokens: input,
    outputTokens: output,
    ...(total === undefined ? {} : { totalTokens: total }),
    ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
  };
}

function failureReason(value: unknown, fallbackCode = "FAILED"): FinishReason {
  const object = objectValue(value);
  const error = objectValue(object?.error) ?? objectValue(value);
  const code = stringValue(error?.code) ?? fallbackCode;
  const message = stringValue(error?.message) ?? "Responses request failed.";
  return { kind: "error", failure: { code, message, exposeCode: true } };
}

function errorReason(code: string, message: string): FinishReason {
  return { kind: "error", failure: { code, message } };
}
