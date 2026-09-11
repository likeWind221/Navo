import { describe, expect, it } from "vitest";

import type { AssistantContentBlock, AssistantConversationMessage } from "../conversation.js";
import { formatDuration, processSummary, shouldFoldProcess, splitTurnContent } from "../process.js";

const reasoning: AssistantContentBlock = { id: "reasoning", kind: "reasoning", text: "先分析", status: "completed" };
const answer: AssistantContentBlock = { id: "answer", kind: "text", text: "最终回答", status: "completed" };
const tool: AssistantContentBlock = {
  id: "tool", kind: "tool-call", toolCallId: "call-1", toolName: "read", arguments: "{}",
  status: "succeeded", summary: "读取完成", detail: "", failure: null,
};

describe("splitTurnContent", () => {
  it("treats the trailing text block as the answer and everything before it as process", () => {
    const content = splitTurnContent([reasoning, answer]);

    expect(content.process).toEqual([reasoning]);
    expect(content.final).toEqual(answer);
  });

  it("has no answer when the turn ends on a tool call", () => {
    const content = splitTurnContent([reasoning, tool]);

    expect(content.process).toEqual([reasoning, tool]);
    expect(content.final).toBeNull();
  });

  it("ignores a trailing text block that has not streamed any text yet", () => {
    const empty: AssistantContentBlock = { id: "answer", kind: "text", text: "  ", status: "streaming" };

    expect(splitTurnContent([reasoning, empty]).final).toBeNull();
  });
});

describe("shouldFoldProcess", () => {
  const content = splitTurnContent([reasoning, answer]);

  it("waits for the turn to end", () => {
    expect(shouldFoldProcess(content, "waiting")).toBe(false);
    expect(shouldFoldProcess(content, "streaming")).toBe(false);
    expect(shouldFoldProcess(content, "completed")).toBe(true);
    expect(shouldFoldProcess(content, "cancelled")).toBe(true);
    expect(shouldFoldProcess(content, "failed")).toBe(true);
    expect(shouldFoldProcess(content, "truncated")).toBe(true);
  });

  it("keeps the process visible when there is nothing to fold next to", () => {
    expect(shouldFoldProcess(splitTurnContent([answer]), "completed")).toBe(false);
    expect(shouldFoldProcess(splitTurnContent([reasoning]), "completed")).toBe(false);
    expect(shouldFoldProcess(splitTurnContent([tool]), "completed")).toBe(false);
  });
});

describe("processSummary", () => {
  it("reports the elapsed time of a finished turn", () => {
    expect(processSummary(message(1_000, 13_000))).toBe("已处理 12s");
    expect(processSummary(message(0, 60_000))).toBe("已处理 1m");
    expect(processSummary(message(0, 95_000))).toBe("已处理 1m 35s");
  });

  it("reports a running turn without a duration", () => {
    expect(processSummary(message(1_000, null))).toBe("处理中");
  });
});

describe("formatDuration", () => {
  it("rounds to seconds and never reports zero", () => {
    expect(formatDuration(0)).toBe("1s");
    expect(formatDuration(400)).toBe("1s");
    expect(formatDuration(1_400)).toBe("1s");
    expect(formatDuration(1_600)).toBe("2s");
  });
});

function message(startedAt: number, endedAt: number | null): AssistantConversationMessage {
  return {
    id: "assistant-1", role: "assistant", text: "", failure: null,
    status: endedAt === null ? "streaming" : "completed", startedAt, endedAt,
  };
}
