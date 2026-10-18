import { createToolCallId } from "../../../src/brand/ids.js";
import { MockLLMAdapter } from "../../../src/llm/adapters/mock.js";
import type { MockLLMEntry } from "../../../src/llm/adapters/mock.js";
import { SEND_TO_MAIN_TOOL_NAME } from "../../../src/tools/builtins/mailbox/send.js";
import { SUBMIT_COMPLETION_TOOL_NAME } from "../../../src/tools/builtins/node/submit.js";
import { SUBMIT_REVIEW_TOOL_NAME } from "../../../src/tools/builtins/project/review.js";
import { modelError, modelResponse } from "../../helpers/runtime.js";

export const LARGE_TEXT_CHARS = 10_000;
export const SUMMARY_TEXT = "## Goal and User Constraints\n- Keep the approved work plan.\n## Progress\n- Earlier Turns completed.";

export function textReply(label: string, size = LARGE_TEXT_CHARS): MockLLMEntry {
  return modelResponse([{ type: "text", text: `${label}:${"x".repeat(size)}` }]);
}

export function toolReply(label: string, id: string, size = LARGE_TEXT_CHARS): MockLLMEntry {
  return modelResponse([
    { type: "text", text: `${label}:${"y".repeat(size)}` },
    {
      type: "tool-call",
      id: createToolCallId(id),
      name: SEND_TO_MAIN_TOOL_NAME,
      arguments: JSON.stringify({ message: `${label} progress report` }),
    },
  ], "tool-calls");
}

export function submitReply(id: string): MockLLMEntry {
  return modelResponse([{
    type: "tool-call",
    id: createToolCallId(id),
    name: SUBMIT_COMPLETION_TOOL_NAME,
    arguments: JSON.stringify({
      summary: "Submitted for review",
      resource_ids: [],
      criteria: [{ criterion_index: 1, satisfied: true, note: "Checked" }],
      remaining: [],
    }),
  }], "tool-calls");
}

export function reviewReplies(
  id: string,
  decision: "complete" | "rework" | "skip",
  feedback?: string,
): MockLLMEntry[] {
  return [
    modelResponse([{
      type: "tool-call",
      id: createToolCallId(id),
      name: SUBMIT_REVIEW_TOOL_NAME,
      arguments: JSON.stringify({
        decision,
        reason: "Reviewed the submitted work and checked its evidence",
        ...(feedback === undefined ? {} : { feedback }),
      }),
    }], "tool-calls"),
    modelResponse([{ type: "text", text: "Review recorded." }]),
  ];
}

export function gatedTextReply(label: string) {
  const started = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const entry: MockLLMEntry = {
    kind: "handler",
    async *handle(request) {
      started.resolve();
      await release.promise;
      yield* new MockLLMAdapter([textReply(label)]).stream(request);
    },
  };
  return { entry, started: started.promise, release: () => release.resolve() };
}

export function overflowReply(): MockLLMEntry {
  return modelError("CONTEXT_WINDOW_EXCEEDED");
}

export function summaryReply(text = SUMMARY_TEXT): MockLLMEntry {
  return modelResponse([{ type: "text", text }]);
}

export function summaryFailure(): MockLLMEntry {
  return modelError("INVALID_REQUEST");
}
