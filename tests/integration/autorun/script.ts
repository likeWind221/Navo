import { createToolCallId } from "../../../src/brand/ids.js";
import type { MockLLMEntry } from "../../../src/llm/adapters/mock.js";
import { SUBMIT_COMPLETION_TOOL_NAME } from "../../../src/tools/builtins/node/submit.js";
import { SUBMIT_REVIEW_TOOL_NAME } from "../../../src/tools/builtins/project/review.js";
import { modelError, modelResponse } from "../../helpers/runtime.js";

const text = (value = "Turn complete.") => modelResponse([{ type: "text", text: value }]);

function call(id: string, name: string, arguments_: unknown) {
  return modelResponse([{
    type: "tool-call",
    id: createToolCallId(id),
    name,
    arguments: JSON.stringify(arguments_),
  }], "tool-calls");
}

function submit(id: string): MockLLMEntry[] {
  return [call(id, SUBMIT_COMPLETION_TOOL_NAME, {
    summary: "Submitted for review",
    resource_ids: [],
    criteria: [{ criterion_index: 1, satisfied: true, note: "Checked" }],
    remaining: [],
  })];
}

function review(id: string, decision: "complete" | "rework" | "skip", feedback?: string): MockLLMEntry[] {
  return [call(id, SUBMIT_REVIEW_TOOL_NAME, {
    decision,
    reason: "Reviewed the submitted work",
    ...(feedback === undefined ? {} : { feedback }),
  }), text()];
}

export function reworkSkipScenario(): readonly MockLLMEntry[] {
  const first = submit("a-draft");
  const delayed = first[0]!;
  if (delayed.kind !== "events") throw new Error("submit mock must be an events entry");
  return [
    { ...delayed, eventDelayMs: 10 },
    ...review("a-rework", "rework", "Address the missing detail."),
    ...submit("a-final"),
    ...review("a-complete", "complete"),
    ...submit("b-submit"),
    ...review("b-skip", "skip"),
  ];
}

export function failureScenario(): readonly MockLLMEntry[] {
  return [
    modelError("provider-failed"),
    ...submit("retry-submit"),
    ...review("retry-complete", "complete"),
  ];
}