import { createToolCallId } from "../../../brand/ids.js";
import type { ContentBlockType, JsonObject, ReplayItem } from "../../types.js";
import {
  arrayValue,
  invalidEvent,
  isJsonObject,
  stringValue,
} from "./event.js";

export interface ResponsesItemState {
  readonly outputIndex: number;
  contentType: ContentBlockType | undefined;
  itemId: string | undefined;
  callId: string | undefined;
  name: string | undefined;
  namespace: string | undefined;
  arguments: string;
  text: string;
  textParts: Map<number, string>;
  summaries: Map<number, string>;
  started: boolean;
  itemDone: boolean;
  contentDone: boolean;
  status: string | undefined;
  payload: JsonObject | undefined;
}

export function upsertItem(
  items: Map<number, ResponsesItemState>,
  index: number,
  item: JsonObject,
): ResponsesItemState {
  const type = itemType(item);
  const existing = items.get(index);
  if (existing !== undefined) {
    if (existing.contentType !== undefined && existing.contentType !== type) {
      throw invalidEvent("output item changed type.");
    }
    existing.contentType = type;
    applyIdentity(existing, item);
    existing.payload = item;
    return existing;
  }
  const state: ResponsesItemState = {
    outputIndex: index,
    contentType: type,
    arguments: "",
    text: "",
    textParts: new Map(),
    summaries: new Map(),
    started: false,
    itemDone: false,
    contentDone: false,
    itemId: undefined,
    callId: undefined,
    name: undefined,
    namespace: undefined,
    status: undefined,
    payload: item,
  };
  applyIdentity(state, item);
  items.set(index, state);
  return state;
}

export function stateFor(
  items: Map<number, ResponsesItemState>,
  index: number,
  contentType: ContentBlockType,
): ResponsesItemState {
  const state = items.get(index);
  if (state !== undefined) {
    if (state.contentType !== contentType) throw invalidEvent("output item changed type.");
    return state;
  }
  const created: ResponsesItemState = {
    outputIndex: index,
    contentType,
    arguments: "",
    text: "",
    textParts: new Map(),
    summaries: new Map(),
    started: false,
    itemDone: false,
    contentDone: false,
    itemId: undefined,
    callId: undefined,
    name: undefined,
    namespace: undefined,
    status: undefined,
    payload: undefined,
  };
  items.set(index, created);
  return created;
}

export function reconcileText(state: ResponsesItemState, value: string): string {
  return reconcileTextPart(state, 0, value);
}

export function appendTextPart(
  state: ResponsesItemState,
  index: number,
  delta: string,
): string {
  const current = state.textParts.get(index) ?? "";
  return reconcileTextPart(state, index, current + delta);
}

export function reconcileTextPart(
  state: ResponsesItemState,
  index: number,
  value: string,
): string {
  const current = state.textParts.get(index) ?? "";
  if (current === value) return "";
  if (!value.startsWith(current)) throw invalidEvent("output text changed its prefix.");
  state.textParts.set(index, value);
  const aggregate = [...state.textParts.entries()].sort(([a], [b]) => a - b)
    .map(([, text]) => text).join("");
  if (!aggregate.startsWith(state.text)) throw invalidEvent("output text changed its prefix.");
  const delta = aggregate.slice(state.text.length);
  state.text = aggregate;
  return delta;
}

export function reconcileArguments(state: ResponsesItemState, value: string): string {
  if (state.arguments === value) return "";
  if (!value.startsWith(state.arguments)) {
    throw invalidEvent("function call arguments changed their prefix.");
  }
  const delta = value.slice(state.arguments.length);
  state.arguments = value;
  return delta;
}

export function itemVisibleParts(item: JsonObject): readonly { index: number; text: string }[] | undefined {
  const content = arrayValue(item.content);
  if (content === undefined) return undefined;
  return content.flatMap((value, index) => {
    if (!isJsonObject(value) || (value.type !== "output_text" && value.type !== "refusal")) {
      return [];
    }
    return [{ index, text: value.type === "refusal"
      ? stringValue(value.refusal) ?? "" : stringValue(value.text) ?? "" }];
  });
}

export function itemSummary(item: JsonObject): readonly string[] | undefined {
  const summary = arrayValue(item.summary);
  if (summary === undefined) return undefined;
  return summary.filter(isJsonObject)
    .filter((part) => part.type === "summary_text")
    .map((part) => stringValue(part.text) ?? "");
}

export function reconcileSummary(
  state: ResponsesItemState,
  index: number,
  value: string,
): string {
  const current = state.summaries.get(index) ?? "";
  if (current === value) return "";
  if (!value.startsWith(current)) throw invalidEvent("reasoning summary changed its prefix.");
  state.summaries.set(index, value);
  const aggregate = [...state.summaries.entries()].sort(([a], [b]) => a - b)
    .map(([, text]) => text).join("");
  if (!aggregate.startsWith(state.text)) throw invalidEvent("reasoning summary changed its prefix.");
  const delta = aggregate.slice(state.text.length);
  state.text = aggregate;
  return delta;
}

export function itemArguments(item: JsonObject): string | undefined {
  return stringValue(item.arguments);
}

export function toolId(state: ResponsesItemState): ReturnType<typeof createToolCallId> {
  if (state.callId === undefined) throw invalidEvent("function call has no call_id.");
  return createToolCallId(state.callId);
}

export function completeTool(state: ResponsesItemState): boolean {
  return state.callId !== undefined && state.name !== undefined && state.name.length > 0
    && state.itemDone && state.status !== "incomplete";
}

export function replayItems(
  items: Map<number, ResponsesItemState>,
): readonly ReplayItem[] {
  return [...items.values()].sort((a, b) => a.outputIndex - b.outputIndex)
    .filter((state) => state.payload !== undefined
      && (state.started || state.contentType === "reasoning"))
    .map((state) => ({
      contentIndex: state.started ? state.outputIndex : null,
      payload: replayPayload(state),
    }));
}

function replayPayload(state: ResponsesItemState): JsonObject {
  const payload = state.payload!;
  if (state.contentType === "text" && payload.type === "message") {
    return {
      ...payload,
      ...(Array.isArray(payload.content) ? {
        content: payload.content.map((part) => isJsonObject(part)
          && (part.type === "output_text" || part.type === "refusal")
          ? part.type === "refusal" ? { ...part, refusal: "" } : { ...part, text: "" } : part),
      } : {}),
    };
  }
  if (state.contentType === "reasoning" && payload.type === "reasoning") {
    return {
      ...payload,
      ...(Array.isArray(payload.summary) ? {
        summary: payload.summary.map((part) => isJsonObject(part) && part.type === "summary_text"
          ? { ...part, text: "" } : part),
      } : {}),
    };
  }
  if (state.contentType === "tool-call") return { ...payload, arguments: "" };
  return payload;
}

function itemType(item: JsonObject): ContentBlockType | undefined {
  return item.type === "message" ? "text"
    : item.type === "reasoning" ? "reasoning"
      : item.type === "function_call" ? "tool-call" : undefined;
}

function applyIdentity(state: ResponsesItemState, item: JsonObject): void {
  const type = itemType(item);
  if (type === undefined) throw invalidEvent("output item type is invalid.");
  assignIdentity(state, "id", stringValue(item.id));
  assignIdentity(state, "call_id", stringValue(item.call_id));
  assignIdentity(state, "name", stringValue(item.name));
  assignIdentity(state, "namespace", stringValue(item.namespace));
  state.status = stringValue(item.status) ?? state.status;
}

function assignIdentity(
  state: ResponsesItemState,
  field: "id" | "call_id" | "name" | "namespace",
  value: string | undefined,
): void {
  const key = field === "call_id" ? "callId" : field === "namespace" ? "namespace"
    : field === "id" ? "itemId" : "name";
  const current = state[key];
  if (current !== undefined && value !== undefined && current !== value) {
    throw invalidEvent(`output item ${field} changed.`);
  }
  if (current === undefined && value !== undefined) state[key] = value;
}
