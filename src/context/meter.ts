import type { GenerateRequest, Message, MessageContent, TokenUsage, ToolSchema } from "../llm/types.js";
import type { AssistantMessageEvent, LlmRequestedEvent, SessionEvent } from "../session/types.js";

export interface ContextMeasurement {
  readonly usedTokens: number;
  readonly estimatedRequestTokens: number;
  readonly basis: "usage" | "estimate";
}

export type ContextRequest = Pick<GenerateRequest, "provider" | "model" | "messages" | "tools" | "turnContext">;

const CHARS_PER_TOKEN = 4;
const BLOCK_OVERHEAD = 4;
const MESSAGE_OVERHEAD = 4;
const DENSE_SCRIPT = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/u;

export function measureContext(events: readonly SessionEvent[], request: ContextRequest): ContextMeasurement {
  const estimatedRequestTokens = estimateRequest(request);
  const anchor = findAnchor(events, request);
  if (anchor === undefined) {
    return Object.freeze({ usedTokens: estimatedRequestTokens, estimatedRequestTokens, basis: "estimate" });
  }
  const anchorEstimate = estimateRequest(anchor.request.data) + (anchor.request.data.contextTokens ?? 0) + estimateMessage(anchor.reply.data.message);
  const usageTokens = anchor.usage.inputTokens + anchor.usage.outputTokens;
  const baseline = Math.max(usageTokens, anchorEstimate);
  return Object.freeze({
    usedTokens: Math.max(0, baseline + estimatedRequestTokens - anchorEstimate),
    estimatedRequestTokens,
    basis: usageTokens >= anchorEstimate ? "usage" : "estimate",
  });
}

export function estimateRequest(request: Pick<ContextRequest, "messages" | "tools" | "turnContext">): number {
  return request.messages.reduce((total, message) => total + estimateMessage(message), 0)
    + estimateTools(request.tools ?? [])
    + (request.turnContext === undefined ? 0 : estimateMessage(request.turnContext));
}

export function estimateMessage(message: Message): number {
  const hidden = message.replay?.items
    .filter(item => item.contentIndex === null)
    .reduce((total, item) => total + estimateText(JSON.stringify(item.payload)), 0) ?? 0;
  return MESSAGE_OVERHEAD + estimateContent(message.content) + hidden;
}

export function estimateTools(tools: readonly ToolSchema[]): number {
  return tools.reduce((total, tool) => total + BLOCK_OVERHEAD + estimateText(JSON.stringify(tool)), 0);
}

export function estimateText(text: string): number {
  let dense = 0;
  let sparse = 0;
  for (const char of text) {
    if (DENSE_SCRIPT.test(char)) dense += 1;
    else sparse += 1;
  }
  return dense + Math.ceil(sparse / CHARS_PER_TOKEN);
}

function estimateContent(content: readonly MessageContent[]): number {
  return content.reduce((total, block) => total + BLOCK_OVERHEAD + estimateBlock(block), 0);
}

function estimateBlock(block: MessageContent): number {
  switch (block.type) {
    case "text":
    case "reasoning":
      return estimateText(block.text);
    case "tool-call":
      return estimateText(block.name) + estimateText(block.arguments);
    case "tool-result":
      return estimateContent(block.content);
  }
}

interface Anchor {
  readonly request: LlmRequestedEvent;
  readonly reply: AssistantMessageEvent;
  readonly usage: TokenUsage;
}

function findAnchor(events: readonly SessionEvent[], request: ContextRequest): Anchor | undefined {
  let index = events.length - 1;
  while (index >= 0 && events[index]!.type !== "assistant-message") index -= 1;
  if (index < 0) return undefined;
  const reply = events[index] as AssistantMessageEvent;
  const usage = reply.data.usage;
  if (usage === undefined) return undefined;
  for (index -= 1; index >= 0; index -= 1) {
    const event = events[index]!;
    if (event.type !== "llm-requested" || event.data.stepId !== reply.data.stepId) continue;
    return event.data.provider === request.provider && event.data.model === request.model
      ? { request: event, reply, usage } : undefined;
  }
  return undefined;
}
