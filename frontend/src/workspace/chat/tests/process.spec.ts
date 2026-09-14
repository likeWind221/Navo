import { describe, expect, it } from "vitest";

import type { AssistantContentBlock, AssistantConversationMessage } from "../conversation.js";
import {
  formatDuration,
  processSummary,
  reasoningSummary,
  shouldFoldProcess,
  splitTurnContent,
  toolProcessLabel,
} from "../process.js";

const reasoning: AssistantContentBlock = { id: "reasoning", kind: "reasoning", text: "先分析", status: "completed" };
const answer: AssistantContentBlock = { id: "answer", kind: "text", text: "最终回答", status: "completed" };
const tool: AssistantContentBlock = {
  id: "tool", kind: "tool-call", startedAt: 0, endedAt: 2_000, toolCallId: "call-1", toolName: "read", arguments: "{}",
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
  it("shows live elapsed time without changing the status title", () => {
    expect(processSummary(message(1_000, null), 5_000)).toBe("处理中 4s");
    expect(processSummary(message(1_000, null), 13_000)).toBe("处理中 12s");
  });

  it("freezes the total time of a finished turn", () => {
    const finished = message(1_000, 13_000);
    expect(processSummary(finished, 99_000)).toBe("已处理 12s");
    expect(processSummary(message(0, 60_000))).toBe("已处理 1m");
    expect(processSummary(message(0, 95_000))).toBe("已处理 1m 35s");
  });
});

describe("process labels", () => {
  it("uses a compact reasoning sentence after streaming finishes", () => {
    expect(reasoningSummary("## 先检查现有结构。然后继续。" )).toBe("先检查现有结构。");
    expect(reasoningSummary("   ")).toBe("思考过程");
    expect(reasoningSummary("这是一段没有标点而且长度明显超过三十六个字符的思考内容用于验证截断行为不会撑坏过程行布局"))
      .toMatch(/…$/);
  });

  it("uses stable execution labels for tools", () => {
    expect(toolProcessLabel("shell")).toBe("执行Shell");
    expect(toolProcessLabel("Shell")).toBe("执行Shell");
    expect(toolProcessLabel("read")).toBe("执行 read");
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
