import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { Composer } from "../Composer.js";

describe("Composer", () => {
  it("renders a disabled send button for an empty idle draft", () => {
    const markup = renderToStaticMarkup(
      <Composer busy={false} onSubmit={vi.fn(() => true)} onCancel={vi.fn(() => true)} />,
    );

    expect(markup).toContain("aria-label=\"发送消息\"");
    expect(markup).toContain("disabled=\"\"");
    expect(markup).toContain("Enter 发送，Shift + Enter 换行");
  });

  it("switches the primary control to an enabled stop button while busy", () => {
    const markup = renderToStaticMarkup(
      <Composer busy onSubmit={vi.fn(() => true)} onCancel={vi.fn(() => true)} />,
    );

    expect(markup).toContain("type=\"button\"");
    expect(markup).toContain("aria-label=\"停止生成\"");
    expect(markup).not.toContain("disabled=\"\"");
  });

  it("disables an idle draft with a caller-owned reason", () => {
    const markup = renderToStaticMarkup(
      <Composer value="节点草稿" disabled disabledHint="等待前置节点完成" busy={false} onSubmit={vi.fn(() => true)} onCancel={vi.fn(() => true)} onChange={vi.fn()} />,
    );

    expect(markup).toMatch(/<textarea[^>]*disabled=""/);
    expect(markup).toContain("等待前置节点完成");
    expect(markup).toContain(">节点草稿</textarea>");
  });

  it("supports a caller-owned draft and unique input ids", () => {
    const markup = renderToStaticMarkup(
      <Composer value="项目草稿" inputId="project-p-1-chat-input" onChange={vi.fn()} busy={false} onSubmit={vi.fn(() => true)} onCancel={vi.fn(() => true)} />,
    );

    expect(markup).toContain('id="project-p-1-chat-input"');
    expect(markup).toContain(">项目草稿</textarea>");
    expect(markup).toContain('aria-describedby="project-p-1-chat-input-help"');
  });
});
