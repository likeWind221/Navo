import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ConversationMessage } from "../conversation.js";
import { MessageList } from "../List.js";

describe("MessageList", () => {
  it("renders user and assistant text as escaped plain text", () => {
    const markup = render([
      { id: "user-1", role: "user", text: "<script>alert(1)</script>" },
      assistant("回答", "completed"),
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
});

function render(messages: readonly ConversationMessage[]): string {
  return renderToStaticMarkup(<MessageList messages={messages} />);
}

function assistant(
  text: string,
  status: Extract<ConversationMessage, { readonly role: "assistant" }>["status"],
  failure: Extract<ConversationMessage, { readonly role: "assistant" }>["failure"] = null,
): ConversationMessage {
  return { id: `assistant-${status}`, role: "assistant", text, status, failure };
}
