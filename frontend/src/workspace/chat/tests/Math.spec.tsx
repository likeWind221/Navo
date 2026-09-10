import type { Nodes } from "mdast";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../Markdown.js";
import { MessageList } from "../List.js";
import { parseMarkdown } from "../markdown/parse.js";

function formulas(text: string, streaming = false): Nodes[] {
  const result: Nodes[] = [];
  function visit(node: Nodes): void {
    if (node.type === "math" || node.type === "inlineMath") result.push(node);
    if ("children" in node) node.children.forEach(visit);
  }
  visit(parseMarkdown(text, streaming));
  return result;
}

describe("math parsing", () => {
  it.each([
    ["行内 $x^2$ 公式", "inlineMath", "x^2"],
    [String.raw`行内 \(\frac{1}{2}\) 公式`, "inlineMath", String.raw`\frac{1}{2}`],
    ["$$\nx^2\n$$", "math", "x^2"],
    ["$$x^2$$", "math", "x^2"],
    [String.raw`\[x^2\]`, "math", "x^2"],
    ["\\[\nx^2\n\\]", "math", "x^2"],
    ["> $$\n> x^2\n> $$", "math", "x^2"],
    ["- 公式\n\n  $$\n  x^2\n  $$", "math", "x^2"],
  ])("parses %s", (source, type, value) => {
    expect(formulas(source!)).toMatchObject([{ type, value }]);
  });

  it.each(["$x", "$$\nx^2", "$$", "$$x", String.raw`\(x`, String.raw`\[x`, "> $$\n> x", "- 项目\n\n  $$\n  x"])("keeps incomplete %s out of KaTeX", (source) => {
    expect(formulas(source)).toEqual([]);
    expect(renderToStaticMarkup(<Markdown text={source} />)).not.toContain("data-math=");
  });

  it("does not interpret code, escaped dollars or lone currency signs", () => {
    expect(formulas("`$x$`\n\n```tex\n\\[x\\]\n$$y$$\n```\n\n\\$5 和 $10")).toEqual([]);
  });

  it("switches grammar only when the content settles", () => {
    const source = "$x^2$\n\n\\[y^2\\]";
    expect(formulas(source, true)).toEqual([]);
    expect(formulas(source)).toHaveLength(2);
    expect(renderToStaticMarkup(<Markdown text={source} streaming />)).not.toContain("data-math=");
    expect(renderToStaticMarkup(<Markdown text={source} />)).toContain('data-math="inline"');
  });

  it.each(["completed", "cancelled", "failed", "truncated"] as const)("renders formulas in retained %s content", (status) => {
    const html = renderToStaticMarkup(<MessageList messages={[{
      id: "a", role: "assistant", text: "$x$", status, failure: null,
      blocks: [
        { id: "r", kind: "reasoning", text: "$r$", status: "streaming" },
        { id: "t", kind: "text", text: "$$x$$", status: "streaming" },
      ],
    }]} />);
    expect(html).toContain('data-math="inline"');
    expect(html).toContain('data-math="block"');
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).not.toContain("思考中");
    expect(html).not.toContain("streamCursor");
  });

  it("keeps formulas as literal text until the turn ends", () => {
    const blocks = [{ id: "t", kind: "text" as const, text: "$x$", status: "streaming" as const }];
    const streaming = renderToStaticMarkup(<MessageList messages={[{ id: "a", role: "assistant", text: "", status: "streaming", failure: null, blocks }]} />);
    const settled = renderToStaticMarkup(<MessageList messages={[{ id: "a", role: "assistant", text: "", status: "completed", failure: null, blocks }]} />);
    expect(streaming).toContain("$x$");
    expect(streaming).not.toContain("data-math=");
    expect(settled).not.toContain("$x$");
    expect(settled).toContain('data-math="inline"');
  });

  it("renders formulas inside legacy assistant text but not user input", () => {
    const html = renderToStaticMarkup(<MessageList messages={[
      { id: "u", role: "user", text: "用户输入 $x$" },
      { id: "a", role: "assistant", text: "旧版正文 $x$", status: "completed", failure: null },
    ]} />);
    expect(html).toContain("用户输入 $x$");
    expect(html).not.toContain("用户输入 <span");
    expect(html).toContain('data-math="inline"');
  });

  it("keeps adjacent, escaped and nested delimiters apart", () => {
    expect(formulas("$a$ 与 $b$")).toMatchObject([{ type: "inlineMath", value: "a" }, { type: "inlineMath", value: "b" }]);
    expect(formulas(String.raw`\\(x\\) 不是公式`)).toEqual([]);
    expect(formulas("$x$$y$")).toMatchObject([{ type: "inlineMath", value: "x$$y" }]);
    expect(formulas("$$a$b$$")).toMatchObject([{ type: "math", value: "a$b" }]);
  });
});
