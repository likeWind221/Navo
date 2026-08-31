import { expectTypeOf } from "vitest";

import {
  createMessageId,
  createSessionId,
  createToolCallId,
  type MessageId,
  type SessionId,
  type ToolCallId,
} from "../src/brand/ids.js";
import type {
  AssistantMessage,
  FinishReason,
  GenerateResponse,
  ToolCallContentBlock,
  ToolResultContentBlock,
  ToolResultMessage,
  UserMessage,
} from "../src/llm/types.js";

const sessionId = createSessionId("session-1");
const messageId = createMessageId("message-1");
const toolCallId = createToolCallId("call-1");

expectTypeOf(sessionId).toEqualTypeOf<SessionId>();
expectTypeOf(messageId).toEqualTypeOf<MessageId>();
expectTypeOf(toolCallId).toEqualTypeOf<ToolCallId>();

// @ts-expect-error SessionId and MessageId must not be interchangeable.
const invalidMessageId: MessageId = sessionId;
// @ts-expect-error MessageId and ToolCallId must not be interchangeable.
const invalidToolCallId: ToolCallId = messageId;

const toolCall = {
  type: "tool-call",
  id: toolCallId,
  name: "echo",
  arguments: '{"text":"hello"}',
} satisfies ToolCallContentBlock;

const toolResult = {
  type: "tool-result",
  toolCallId,
  content: [{ type: "text", text: "hello" }],
  isError: false,
} satisfies ToolResultContentBlock;

expectTypeOf(toolCall.id).toEqualTypeOf<ToolCallId>();
expectTypeOf(toolResult.toolCallId).toEqualTypeOf<ToolCallId>();

const userMessage = {
  id: messageId,
  role: "user",
  content: [{ type: "text", text: "hello" }],
} satisfies UserMessage;

const toolResultMessage = {
  id: messageId,
  role: "user",
  content: [toolResult],
} satisfies ToolResultMessage;

expectTypeOf(userMessage.role).toEqualTypeOf<"user">();
expectTypeOf(toolResultMessage.content[0]).toMatchTypeOf<ToolResultContentBlock>();

const response = {
  message: {
    id: messageId,
    role: "assistant",
    content: [{ type: "text", text: "done" }],
  },
  finishReason: { kind: "stop" },
} satisfies GenerateResponse;

expectTypeOf(response.message).toMatchTypeOf<AssistantMessage>();
expectTypeOf(response.message.role).toEqualTypeOf<"assistant">();

const failed: FinishReason = {
  kind: "error",
  failure: { code: "provider-unavailable", message: "Provider unavailable" },
};

expectTypeOf(failed).toEqualTypeOf<Extract<FinishReason, { kind: "error" }>>();

// @ts-expect-error An error finish reason must include LlmFailure facts.
const invalidFinishReason: FinishReason = { kind: "error" };

void invalidMessageId;
void invalidToolCallId;
void invalidFinishReason;
