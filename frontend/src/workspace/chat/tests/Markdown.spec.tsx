import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "../Markdown.js";
import { externalHref } from "../../../../shared/link.js";

const render = (text: string): string => renderToStaticMarkup(<Markdown text={text} />);

describe("Markdown", () => {
  it("renders headings, emphasis, quotes, ordered lists and GFM", () => {
    const html = render("# 标题\n\n**重点**、*强调*、~~删除~~\n\n> 引用\n\n3. 三\n4. 四\n\n- [x] 已完成\n- [ ] 未完成\n\n| 名称 | 值 |\n| --- | ---: |\n| 项目 | 1 |");
    expect(html).toContain("<h1>标题</h1>");
    expect(html).toContain("<strong>重点</strong>");
    expect(html).toContain("<em>强调</em>");
    expect(html).toContain("<del>删除</del>");
    expect(html).toContain("<blockquote>");
    expect(html).toContain('<ol start="3">');
    expect(html).toContain('type="checkbox"');
    expect(html).toContain('checked=""');
    expect(html).toContain('<td style="text-align:right">1</td>');
  });

  it("escapes HTML and code, blocks unsafe links and does not load images", () => {
    const html = render('<script>alert(1)</script>\n\n[bad](javascript:alert%281%29) [file](file:///tmp/a) [relative](./a)\n\n![图示](https://example.com/image.png)\n\n```html\n<img src=x onerror=alert(1)>\n```');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("href=");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(html).toContain("图示");
  });

  it("opens approved links externally and resolves later reference definitions", () => {
    expect(render("[官方][site]")).toContain("[官方][site]");
    const html = render("[官方][site]\n\n[site]: https://example.com");
    expect(html).toContain('href="https://example.com/"');
    expect(html).toContain('target="_blank" rel="noopener noreferrer"');
    expect(externalHref("mailto:test@example.com")).toBe("mailto:test@example.com");
    for (const url of ["javascript:alert(1)", "data:text/html,test", "file:///C:/test", "./relative", "//example.com"]) {
      expect(externalHref(url)).toBeNull();
    }
  });

  it("reparses cumulative chunks including incomplete fences and replaced text", () => {
    expect(render("**重点")).not.toContain("<strong>");
    expect(render("**重点**")).toContain("<strong>重点</strong>");
    const prefix = "```ts\nconst value = '<b>';";
    expect(render(prefix)).toContain("const value = &#x27;&lt;b&gt;&#x27;;");
    expect(render(prefix + "\n```\n\n结束")).toContain("<p>结束</p>");
    expect(render("替换后的内容")).not.toContain("const value");
  });

  it("renders footnotes with per-message generated fragment ids", () => {
    const html = render("正文[^a]\n\n[^a]: 注释");
    expect(html).toContain('aria-label="脚注 1"');
    expect(html).toContain('aria-label="脚注"');
    expect(html).toContain("注释");
  });
});
