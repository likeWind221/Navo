import { readResponsesReplay } from "./replay.js";
import { createToolCallId } from "../../../brand/ids.js";
import type {
  AssistantMessage,
  ContentBlock,
  GenerateRequest,
  JsonObject,
  JsonValue,
  Message,
  ToolCallContentBlock,
} from "../../types.js";

export interface ResponsesRequestOptions {
  readonly toolNamespace: string;
}

export function serializeResponsesRequest(
  request: GenerateRequest,
  options: ResponsesRequestOptions,
): Readonly<Record<string, JsonValue>> {
  const callIds = new Map<string, FunctionCallReference>();
  const input = request.messages.flatMap((message) =>
    serializeMessage(message, request, options, callIds));
  return {
    model: request.model,
    input,
    stream: true,
    store: false,
    ...(request.tools === undefined || request.tools.length === 0 ? {} : {
      tools: [{
        type: "namespace",
        name: options.toolNamespace,
        tools: request.tools.map((tool) => ({
          type: "function",
          name: tool.name,
          ...(tool.description === undefined ? {} : { description: tool.description }),
          parameters: tool.parameters,
        })),
      }],
    }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxTokens === undefined ? {} : { max_output_tokens: request.maxTokens }),
  };
}

function serializeMessage(
  message: Message,
  request: GenerateRequest,
  options: ResponsesRequestOptions,
  callIds: Map<string, FunctionCallReference>,
): readonly JsonObject[] {
  const toolResult = message.content.find((block) => block.type === "tool-result");
  if (toolResult?.type === "tool-result") {
    const reference = callIds.get(String(toolResult.toolCallId));
    return [{
      type: "function_call_output",
      call_id: reference?.callId ?? String(toolResult.toolCallId),
      ...(reference?.name === undefined ? {} : { name: reference.name }),
      ...(reference?.namespace === undefined ? {} : { namespace: reference.namespace }),
      output: textContent(toolResult.content),
    }];
  }
  if (message.role === "assistant") {
    return serializeAssistant(message as AssistantMessage, request, options, callIds);
  }
  return [{
    type: "message",
    role: message.role === "system" ? "developer" : "user",
    content: textContent(message.content),
  }];
}

function serializeAssistant(
  message: AssistantMessage,
  request: GenerateRequest,
  options: ResponsesRequestOptions,
  callIds: Map<string, FunctionCallReference>,
): readonly JsonObject[] {
  if (message.replay !== undefined) {
    return restoreReplay(message, request, options, callIds);
  }
  const calls = message.content.filter(
    (block): block is ToolCallContentBlock => block.type === "tool-call",
  );
  return [
    ...(calls.length === 0 ? [] : calls.map((call) => {
      callIds.set(String(call.id), {
        callId: String(call.id), name: call.name, namespace: options.toolNamespace,
      });
      return {
        type: "function_call",
        call_id: String(call.id),
        name: call.name,
        namespace: options.toolNamespace,
        arguments: call.arguments,
        status: "completed",
      };
    })),
    ...(textContent(message.content).length === 0 ? [] : [{
      type: "message",
      role: "assistant",
      content: textContent(message.content),
    }]),
  ];
}

function restoreReplay(
  message: AssistantMessage,
  request: GenerateRequest,
  options: ResponsesRequestOptions,
  callIds: Map<string, FunctionCallReference>,
): readonly JsonObject[] {
  const items = readResponsesReplay(message.replay!, request.provider, request.model);
  const used = new Set<number>();
  const payloads = items.map((item) => {
    if (item.contentIndex === null) {
      if (item.payload.type !== "reasoning") throw invalidReplay("hidden item is not reasoning");
      return item.payload;
    }
    const block = message.content[item.contentIndex];
    if (block === undefined || used.has(item.contentIndex)) throw invalidReplay("content index does not match");
    used.add(item.contentIndex);
    if (item.payload.type === "message" && block.type === "text") {
      return restoreMessage(item.payload, block.text);
    }
    if (item.payload.type === "reasoning" && block.type === "reasoning") {
      return restoreReasoning(item.payload, block.text);
    }
    if (item.payload.type === "function_call" && block.type === "tool-call") {
      return restoreFunctionCall(item.payload, block, options, callIds);
    }
    throw invalidReplay("content type does not match");
  });
  if (used.size !== message.content.length) throw invalidReplay("content is incomplete");
  return payloads;
}

function restoreMessage(payload: JsonObject, text: string): JsonObject {
  const content = Array.isArray(payload.content) ? payload.content : [];
  let filled = false;
  const restored = content.map((part) => {
    if (!isJsonObject(part) || (part.type !== "output_text" && part.type !== "refusal")) return part;
    if (filled) return part.type === "refusal"
      ? { ...part, refusal: "" } : { ...part, text: "" };
    filled = true;
    return part.type === "refusal" ? { ...part, refusal: text } : { ...part, text };
  });
  return { ...payload, content: filled ? restored : [{ type: "output_text", text }] };
}

function restoreReasoning(payload: JsonObject, text: string): JsonObject {
  const summary = Array.isArray(payload.summary) ? payload.summary : [];
  let filled = false;
  const restored = summary.map((part) => {
    if (!isJsonObject(part) || part.type !== "summary_text") return part;
    if (filled) return { ...part, text: "" };
    filled = true;
    return { ...part, text };
  });
  return { ...payload, summary: filled ? restored : [{ type: "summary_text", text }] };
}

function restoreFunctionCall(
  payload: JsonObject,
  block: ToolCallContentBlock,
  options: ResponsesRequestOptions,
  callIds: Map<string, FunctionCallReference>,
): JsonObject {
  if (typeof payload.call_id !== "string"
    || createToolCallId(payload.call_id) !== block.id
    || payload.name !== block.name
    || payload.namespace !== options.toolNamespace) {
    throw invalidReplay("function call identity does not match");
  }
  if (typeof payload.id !== "string") throw invalidReplay("function call item id is missing");
  const reference = {
    callId: payload.call_id,
    name: block.name,
    namespace: options.toolNamespace,
  };
  callIds.set(String(block.id), reference);
  return { ...payload, arguments: block.arguments };
}

function textContent(content: readonly Message["content"][number][]): string {
  return content.filter((block) => block.type === "text")
    .map((block) => block.text).join("");
}

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function invalidReplay(message: string): TypeError {
  return new TypeError(`Responses replay ${message}.`);
}

interface FunctionCallReference {
  readonly callId: string;
  readonly name?: string;
  readonly namespace?: string;
}
