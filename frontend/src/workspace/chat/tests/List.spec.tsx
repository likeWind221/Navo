import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type {
  AssistantContentBlock,
  AssistantConversationMessage,
  CommandConversationMessage,
  ConversationMessage,
  ConversationTimelineEntry,
} from "../conversation.js";
import { MessageList } from "../List.js";

describe("MessageList", () => {
  it("escapes user input and raw assistant HTML", () => {
    const markup = render([
      { id: "user-1", role: "user", text: "<script>alert(1)</script>" },
      assistant("回答 <script>alert(1)</script>", "completed"),
    ]);

    expect(markup).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(markup).not.toContain("<script>");
    expect(markup).toContain("回答");
  });

  it("shows waiting, streaming and terminal presentation", () => {
    expect(render([assistant("", "waiting")])).toContain("正在等待 Agent");
    expect(render([assistant("生成中", "streaming")])).toContain("aria-busy=\"true\"");
    expect(render([assistant("部分内容", "cancelled")])).toContain("已停止生成");
    expect(render([assistant("完整内容", "completed")])).not.toContain("messageStatus");
  });

  it("shows stable failure and truncation messages", () => {
    const failed = assistant("部分内容", "failed", { code: "model", message: "模型暂不可用" });
    expect(render([failed])).toContain("模型暂不可用");
    expect(render([assistant("部分内容", "truncated")])).toContain("回答已达到长度上限");
  });
  it("renders reasoning, tool call and text in block order", () => {
    const message = assistant("", "streaming");
    if (message.role !== "assistant") throw new Error("Expected assistant message");
    const blocks: readonly AssistantContentBlock[] = [
      { id: "reasoning", kind: "reasoning", text: "先分析", status: "completed" },
      {
        id: "tool", kind: "tool-call", toolCallId: "call-1", toolName: "read",
        arguments: "{\"path\":\"a.txt\"}", status: "succeeded", summary: "读取完成", detail: "内容",
        failure: null,
      },
      { id: "text", kind: "text", text: "最终回答", status: "streaming" },
    ];
    const markup = render([{ ...message, blocks }]);

    expect(markup.indexOf("先分析")).toBeLessThan(markup.indexOf("read"));
    expect(markup.indexOf("read")).toBeLessThan(markup.indexOf("最终回答"));
    expect(markup).toContain("参数");
    expect(markup).toContain("结果");
    expect(markup).toContain("已成功");
    expect(markup).not.toMatch(/<details[^>]+open/);
  });

  it("renders Markdown in legacy text, v2 text and folded reasoning while preserving user input", () => {
    const markup = render([
      { id: "user", role: "user", text: "**用户原文**" },
      assistant("**旧版正文**", "completed"),
      { ...assistant("", "cancelled"), blocks: [
        { id: "r", kind: "reasoning", text: "**思考**", status: "completed" },
        { id: "t", kind: "text", text: "## 新版正文", status: "completed" },
      ] },
    ]);
    expect(markup).toContain("**用户原文**");
    expect(markup).toContain("<strong>旧版正文</strong>");
    expect(markup).toContain("<strong>思考</strong>");
    expect(markup).toContain("<h2>新版正文</h2>");
    expect(markup).toContain("已停止生成");
    expect(markup).not.toMatch(/<details[^>]+open/);
  });

  it("marks failed and cancelled tool calls", () => {
    const failed: AssistantContentBlock = {
      id: "failed", kind: "tool-call", toolCallId: "call-failed", toolName: "write",
      arguments: "{}", status: "failed", summary: "未写入", detail: "", failure: { code: "denied", message: "没有权限" },
    };
    const cancelled: AssistantContentBlock = {
      id: "cancelled", kind: "tool-call", toolCallId: "call-cancelled", toolName: "read",
      arguments: "{}", status: "cancelled", summary: "", detail: "", failure: null,
    };

    const markup = render([{ ...assistant("", "completed"), blocks: [failed, cancelled] }]);
    expect(markup).toContain("失败");
    expect(markup).toContain("已取消");
    expect(markup).toContain("没有权限");
  });

  it("folds a finished turn's process into one row while keeping the answer visible", () => {
    const blocks: readonly AssistantContentBlock[] = [
      { id: "reasoning", kind: "reasoning", text: "先分析", status: "completed" },
      { id: "answer", kind: "text", text: "最终回答", status: "completed" },
    ];
    const markup = render([{ ...assistant("", "completed"), blocks }]);

    expect(markup).toContain("已处理 4s");
    expect(markup).toContain('aria-expanded="false"');
    expect(markup).toMatch(/processBody[^>]*hidden/);
    expect(markup).toContain("最终回答");
  });

  it("keeps the process expanded while the turn is still streaming", () => {
    const blocks: readonly AssistantContentBlock[] = [
      { id: "reasoning", kind: "reasoning", text: "先分析", status: "completed" },
      { id: "answer", kind: "text", text: "正在写", status: "streaming" },
    ];
    const markup = render([{ ...assistant("", "streaming"), blocks }]);

    expect(markup).toContain('aria-expanded="true"');
    expect(markup).not.toContain("已处理");
  });

  it("keeps a tool-only turn expanded instead of folding it into a lone header", () => {
    const blocks: readonly AssistantContentBlock[] = [{
      id: "tool", kind: "tool-call", toolCallId: "call-1", toolName: "read", arguments: "{}",
      status: "succeeded", summary: "读取完成", detail: "", failure: null,
    }];
    const markup = render([{ ...assistant("", "completed"), blocks }]);

    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("读取完成");
  });

  it("renders command notifications at their timeline position", () => {
    const message: readonly ConversationMessage[] = [
      { id: "user-1", role: "user", text: "before" },
      assistant("after", "completed"),
    ];
    const command: CommandConversationMessage = {
      id: "command-1", role: "system", commandId: "command-1", name: "hello",
      anchor: { kind: "session" }, status: "succeeded", summary: "hello", failure: null,
    };
    const timeline: readonly ConversationTimelineEntry[] = [
      { kind: "message", id: "user-1" },
      { kind: "command", id: "command-1" },
      { kind: "message", id: "assistant-completed" },
    ];
    const markup = render(message, [command], timeline);

    expect(markup.indexOf("before")).toBeLessThan(markup.indexOf("/hello"));
    expect(markup.indexOf("/hello")).toBeLessThan(markup.indexOf("after"));
    expect(markup).toContain("hello");
  });

  it("renders failed and cancelled command notifications", () => {
    const commands: readonly CommandConversationMessage[] = [
      {
        id: "command-failed", role: "system", commandId: "command-failed", name: "unknown",
        anchor: { kind: "session" }, status: "failed", summary: "", failure: { code: "unknown-command", message: "未知命令" },
      },
      {
        id: "command-cancelled", role: "system", commandId: "command-cancelled", name: "hello",
        anchor: { kind: "session" }, status: "cancelled", summary: "", failure: null,
      },
    ];
    const markup = render([], commands, [
      { kind: "command", id: "command-failed" },
      { kind: "command", id: "command-cancelled" },
    ]);

    expect(markup).toContain("未知命令");
    expect(markup).toContain("失败");
    expect(markup).toContain("已取消");
  });
});

function render(
  messages: readonly ConversationMessage[],
  commands: readonly CommandConversationMessage[] = [],
  timeline?: readonly ConversationTimelineEntry[],
): string {
  return renderToStaticMarkup(
    <MessageList messages={messages} commands={commands} {...(timeline === undefined ? {} : { timeline })} />,
  );
}

function assistant(
  text: string,
  status: Extract<ConversationMessage, { readonly role: "assistant" }>["status"],
  failure: Extract<ConversationMessage, { readonly role: "assistant" }>["failure"] = null,
): AssistantConversationMessage {
  return {
    id: `assistant-${status}`, role: "assistant", text, status, failure,
    startedAt: 0, endedAt: status === "waiting" || status === "streaming" ? null : 4_000,
  };
}
