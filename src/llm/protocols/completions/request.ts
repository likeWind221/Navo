import type {
  GenerateRequest,
  JsonValue,
  Message,
  MessageContent,
  ToolCallContentBlock,
} from "../../types.js";

export interface ChatCompletionsRequestOptions {
  readonly reasoningField?: "reasoning_content";
}

export function serializeChatCompletionsRequest(
  request: GenerateRequest,
  options: ChatCompletionsRequestOptions = {},
): Readonly<Record<string, JsonValue>> {
  return {
    model: request.model,
    messages: [...request.messages, ...(request.turnContext === undefined ? [] : [request.turnContext])].map((message) => serializeMessage(message, options)) as JsonValue[],
    stream: true,
    stream_options: { include_usage: true },
    ...(request.tools === undefined || request.tools.length === 0
      ? {} : {
          tools: request.tools.map((tool) => ({
            type: "function",
            function: {
              name: tool.name,
              ...(tool.description === undefined ? {} : { description: tool.description }),
              parameters: tool.parameters,
            },
          })) as unknown as JsonValue[],
        }),
    ...(request.temperature === undefined ? {} : { temperature: request.temperature }),
    ...(request.maxTokens === undefined ? {} : { max_tokens: request.maxTokens }),
  };
}

function serializeMessage(
  message: Message,
  options: ChatCompletionsRequestOptions,
): Readonly<Record<string, JsonValue>> {
  const result = message.content.find((block) => block.type === "tool-result");
  if (result?.type === "tool-result") {
    return {
      role: "tool",
      tool_call_id: result.toolCallId,
      content: textContent(result.content),
    };
  }
  const calls = message.content.filter(
    (block): block is ToolCallContentBlock => block.type === "tool-call",
  );
  const reasoning = message.content.filter((block) => block.type === "reasoning")
    .map((block) => block.text).join("");
  return {
    role: message.role,
    content: textContent(message.content),
    ...(message.role === "assistant" && reasoning.length > 0 && options.reasoningField !== undefined
      ? { [options.reasoningField]: reasoning } : {}),
    ...(calls.length === 0 ? {} : {
      tool_calls: calls.map((call) => ({
        id: call.id,
        type: "function",
        function: { name: call.name, arguments: call.arguments },
      })) as JsonValue[],
    }),
  };
}

function textContent(blocks: readonly MessageContent[]): string {
  return blocks.filter((block) => block.type === "text")
    .map((block) => block.text).join("");
}
