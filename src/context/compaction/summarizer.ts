import { randomUUID } from "node:crypto";
import type { Context } from "cordis";

import { createMessageId } from "../../brand/ids.js";
import { collectStream } from "../../llm/collect.js";
import type { Message, TokenUsage } from "../../llm/types.js";
import { runWithModelRetries } from "../../agent/limits.js";
import type { RetryableAttempt } from "../../agent/limits.js";
import { estimateMessage, estimateRequest, estimateText } from "../meter.js";

export const SUMMARY_PREAMBLE = "This checkpoint condenses earlier conversation history. Treat it as established context; continue the task directly without acknowledging the checkpoint.";
export const SUMMARY_OPEN_TAG = "<compacted-summary>";
export const SUMMARY_CLOSE_TAG = "</compacted-summary>";

const SUMMARY_INSTRUCTION = [
  "Compress the conversation above into one durable checkpoint that lets another agent continue the task with minimal loss of essential information.",
  "Output only concise Markdown using every section below in order. Use terse bullets. Write (none) for empty sections.",
  "## Goal and User Constraints",
  "Preserve evolving intent, explicit requirements, prohibitions, and exact wording where it matters.",
  "## Key Facts and Evidence",
  "Preserve exact identifiers, paths, commands, numbers, test results, and source references.",
  "## Decisions and Rationale",
  "Preserve confirmed choices and why rejected alternatives were rejected.",
  "## Progress",
  "Separate completed, in-progress, blocked, and unverified work.",
  "## Errors and Corrections",
  "Preserve important failures, fixes, and user corrections.",
  "## Files and Artifacts",
  "Preserve important read or modified paths and what each contains.",
  "## Open Questions and Next Steps",
  "List unresolved questions and the most useful next actions.",
  "Use the main language of the conversation. Keep code identifiers and quoted strings unchanged.",
  "Merge any earlier <compacted-summary> block into this checkpoint. Keep still-valid facts, update changed facts, and remove stale claims.",
  "Do not mention the compaction request. Do not call tools. Output only the checkpoint Markdown.",
].join("\n");

export interface SummaryResult {
  readonly text: string;
  readonly usage?: TokenUsage;
  readonly estimatedTokens: number;
}

export function summaryFixedTokens(systemMessages: readonly Message[]): number {
  const instruction = {
    id: createMessageId("compaction-instruction"),
    role: "user" as const,
    content: [{ type: "text" as const, text: SUMMARY_INSTRUCTION }],
  };
  return estimateRequest({ messages: [...systemMessages, instruction], tools: [] });
}

export async function summarize(
  ctx: Context,
  provider: string,
  model: string,
  messages: readonly Message[],
  maxTokens: number,
  signal: AbortSignal,
  maxRetries: number,
): Promise<SummaryResult> {
  const requestMessages = [
    ...messages.map(toTextMessage),
    {
      id: createMessageId(randomUUID()),
      role: "user" as const,
      content: [{ type: "text" as const, text: SUMMARY_INSTRUCTION }],
    },
  ];
  const result = await runWithModelRetries(signal, maxRetries, async (): Promise<RetryableAttempt<SummaryResult>> => {
    const collected = await collectStream(ctx.llm.stream({
      provider,
      model,
      messages: requestMessages,
      maxTokens,
      signal,
    }));
    if (signal.aborted || collected.finishReason?.kind === "cancelled") return { kind: "cancelled" };
    if (collected.finishReason?.kind === "error") return { kind: "failed", failure: collected.finishReason.failure };
    if (collected.finishReason?.kind !== "stop") {
      return { kind: "failed", failure: {
        code: collected.finishReason?.kind === "max-tokens" ? "context-compaction-truncated" : "context-compaction-incomplete",
        message: "The summarization request did not finish with a complete text response.",
      } };
    }
    if (collected.content.some(block => block.type === "tool-call")) {
      return { kind: "failed", failure: { code: "context-compaction-tool-call", message: "The summarizer returned a tool call." } };
    }
    const text = collected.content.filter(block => block.type === "text").map(block => block.text).join("\n").trim();
    if (text.length === 0) {
      return { kind: "failed", failure: { code: "context-compaction-empty", message: "The summarizer returned no text." } };
    }
    return { kind: "completed", value: Object.freeze({
      text,
      ...(collected.usage === undefined ? {} : { usage: collected.usage }),
      estimatedTokens: estimateText(text),
    }) };
  });
  if (result.kind === "completed") return result.value;
  if (result.kind === "cancelled") throw new Error("context-compaction-cancelled");
  throw Object.assign(new Error(result.failure.message), { code: result.failure.code });
}

export function createCheckpointText(summary: string): string {
  return SUMMARY_PREAMBLE + "\n\n" + SUMMARY_OPEN_TAG + "\n" + summary + "\n" + SUMMARY_CLOSE_TAG;
}

function toTextMessage(message: Message): Message {
  if (message.role === "system") return message;
  const text = message.content.map(block => {
    if (block.type === "text") return block.text;
    if (block.type === "reasoning") return "[Reasoning]\n" + block.text;
    if (block.type === "tool-call") {
      return "[Tool call id=" + block.id + " name=" + block.name + " arguments=" + block.arguments + "]";
    }
    return "[Tool result id=" + block.toolCallId + " error=" + block.isError + "]\n"
      + block.content.map(item => item.type === "text" || item.type === "reasoning" ? item.text : "[nested tool call]").join("\n");
  }).join("\n");
  return Object.freeze({
    id: message.id,
    role: message.role,
    content: [{ type: "text" as const, text }],
  });
}
