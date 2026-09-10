import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { app, BrowserWindow, ipcMain } from "electron";
import type { DesktopAgentApi, DesktopAgentEvent } from "../../shared/agent.js";

const output = resolve("qa-output");
app.setPath("userData", join(tmpdir(), `skillworld-markdown-${process.pid}`));

async function main(): Promise<void> {
  await app.whenReady();
  const window = new BrowserWindow({ width: 1280, height: 800, show: false,
    webPreferences: { preload: resolve("out/preload/markdown.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  let scope = { sessionId: "local-session", requestId: "", turnId: "qa", stepId: "step", messageId: "message" };
  const emit = (event: Extract<DesktopAgentEvent, { type: "turn-event" }>["event"]): void => {
    window.webContents.send("markdown:event", { type: "turn-event", event });
  };
  ipcMain.handle("markdown:start", (_event, input: Parameters<DesktopAgentApi["startTurn"]>[0]) => {
    scope = { ...scope, requestId: input.requestId };
    emit({ ...scope, type: "turn-started" });
    emit({ ...scope, type: "step-started" });
    emit({ ...scope, type: "content-started", contentIndex: 0, kind: "reasoning" });
    emit({ ...scope, type: "content-delta", contentIndex: 0, delta: "**思考**：检查 Markdown 展示。$r^2$" });
    emit({ ...scope, type: "content-completed", contentIndex: 0 });
    emit({ ...scope, type: "content-started", contentIndex: 1, kind: "text" });
    emit({ ...scope, type: "content-delta", contentIndex: 1, delta: "**流" });
  });
  ipcMain.handle("markdown:cancel", () => emit({ ...scope, type: "turn-cancelled" }));
  const errors: string[] = [];
  window.webContents.on("console-message", (_event, level, message) => { if (level === 3) errors.push(message); });
  try {
    await window.loadFile(resolve("out/renderer/index.html"));
    await window.webContents.executeJavaScript(`(async () => {
      const input = document.querySelector('textarea');
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set.call(input, '**用户原文**');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      await new Promise(requestAnimationFrame);
      input.form.requestSubmit();
    })()`);
    await waitFor(window, `document.querySelector('article[aria-label="Agent 回复"]')?.textContent.includes('**流')`);
    emit({ ...scope, type: "content-delta", contentIndex: 1, delta: "式标题**\n\n## Markdown 验收\n\n> 引用与 **重点**\n\n- [x] 已完成\n- [ ] 待完成\n\n```ts\nconst value = '" + "long_code_".repeat(30) + "';" });
    await waitFor(window, `document.querySelector('pre code')?.textContent.includes('long_code_')`);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[class*="textBlock"] strong')?.textContent`), "流式标题");
    emit({ ...scope, type: "content-delta", contentIndex: 1, delta: "\n```\n\n| 一 | 二 | 三 | 四 | 五 | 六 | 七 | 八 |\n|---|---|---|---|---|---|---|---|\n| 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 |\n\n[外链](https://example.com) [禁止](javascript:alert%281%29)\n\n<script>alert(1)</script>\n\n" + "段落用于检查流式滚动。\n\n".repeat(18) });
    await waitFor(window, `document.querySelector('table') !== null`);
    await frames(window);
    assert.ok(await window.webContents.executeJavaScript(`(() => {
      const h = document.querySelector('[class*="history"]');
      return h.scrollHeight - h.clientHeight - h.scrollTop <= 2;
    })()`));
    await window.webContents.executeJavaScript(`document.querySelector('[class*="history"]').scrollTop = 0`);
    await frames(window);
    const mathSample = [
      "最后追加段落。", "", "## 数学公式验收", "",
      String.raw`勾股定理：$a^2+b^2=c^2$；分式：\(\frac{1}{2}\)。`, "",
      "$$", String.raw`A=\begin{pmatrix}1&2\\3&4\end{pmatrix}`, "$$", "",
      String.raw`\[\int_0^1 x^2\,dx=\frac{1}{3}\]`, "",
      "$$E=mc^2$$", "",
      "$$" + "x_1 + ".repeat(50) + "x_n$$", "",
      String.raw`无效公式：$\frac{$`, "",
      String.raw`不可信命令：$\href{javascript:alert(1)}{bad}$`, "",
      "未闭合公式保留文本：", "$$", String.raw`\frac{1}{`,
    ].join("\n");
    emit({ ...scope, type: "content-delta", contentIndex: 1, delta: mathSample });
    await waitFor(window, `document.body.textContent.includes('最后追加段落')`);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[class*="history"]').scrollTop`), 0);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('[class*="textBlock"] .katex').length`), 0);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('details .katex').length`), 1);
    const markup = await window.webContents.executeJavaScript(`document.querySelector('article[aria-label="Agent 回复"]').innerHTML`);
    assert.ok(!markup.includes("<script"));
    assert.ok(!markup.includes('href="javascript:'));
    assert.ok(markup.includes('target="_blank"'));
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('details').open`), false);
    await window.webContents.executeJavaScript(`document.querySelector('details summary').click()`);
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('details strong').textContent`), "思考");
    await window.webContents.executeJavaScript(`document.querySelector('button[class*="stopButton"]').click()`);
    await waitFor(window, `document.body.textContent.includes('已停止生成')`);
    const mathState = await window.webContents.executeJavaScript(`(() => {
      const block = document.querySelector('[class*="textBlock"]');
      return {
        formulas: block.querySelectorAll('[data-math]').length,
        inline: block.querySelectorAll('[data-math="inline"] .katex').length,
        display: block.querySelectorAll('[data-math="block"] .katex').length,
        errors: [...block.querySelectorAll('.katex-error')].map((element) => element.textContent),
        literal: block.textContent.includes('$$'),
        untrusted: block.querySelectorAll('[data-math] a, [data-math] img, [data-math] script').length,
        html: block.innerHTML,
      };
    })()`);
    assert.equal(mathState.formulas, 8, mathState.html);
    assert.equal(mathState.inline, 3, mathState.html);
    assert.equal(mathState.display, 4, mathState.html);
    assert.ok(mathState.errors.some((text: string) => text.includes("frac")), mathState.html);
    assert.equal(mathState.untrusted, 0, mathState.html);
    await window.webContents.executeJavaScript("document.fonts.ready.then(() => true)");
    assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[class*="history"]').scrollTop`), 0);
    assert.ok(mathState.literal);
    assert.ok(await window.webContents.executeJavaScript(`document.fonts.check('16px KaTeX_Math')`));
    await mkdir(output, { recursive: true });
    await frames(window);
    await writeFile(join(output, "markdown-desktop.png"), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`document.querySelector('[class*="textBlock"] [data-math]').scrollIntoView({ block: 'start' })`);
    await frames(window);
    await writeFile(join(output, "math-desktop.png"), (await window.webContents.capturePage()).toPNG());
    window.setContentSize(547, 760);
    await frames(window);
    const narrow = await window.webContents.executeJavaScript(`(() => {
      const history = document.querySelector('[class*="history"]');
      const pre = document.querySelector('pre');
      const table = document.querySelector('table').parentElement;
      return { historyWidth: history.clientWidth, historyScroll: history.scrollWidth,
        codeWidth: pre.clientWidth, codeScroll: pre.scrollWidth, tableWidth: table.clientWidth, tableScroll: table.scrollWidth };
    })()`);
    assert.ok(narrow.historyScroll <= narrow.historyWidth + 1);
    assert.ok(narrow.codeScroll > narrow.codeWidth);
    assert.ok(narrow.tableScroll > narrow.tableWidth);
    assert.ok(await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-math="block"]')).some(element => element.scrollWidth > element.clientWidth)`));
    const wideMath = await window.webContents.executeJavaScript(`(() => {
      const wide = [...document.querySelectorAll('[data-math="block"]')].filter(element => element.scrollWidth > element.clientWidth);
      const block = document.querySelector('[class*="textBlock"]');
      return { formulas: block.querySelectorAll('[data-math]').length,
        errors: block.querySelectorAll('.katex-error').length,
        untrusted: block.querySelectorAll('[data-math] a, [data-math] img, [data-math] script').length,
        literalFence: block.textContent.includes('$$'),
        scrolled: wide.length, scrolledWidth: wide[0]?.scrollWidth ?? 0, scrolledClient: wide[0]?.clientWidth ?? 0 };
    })()`);
    assert.equal(wideMath.errors, 1, JSON.stringify(wideMath));
    assert.equal(wideMath.untrusted, 0, JSON.stringify(wideMath));
    assert.ok(wideMath.literalFence, JSON.stringify(wideMath));
    assert.ok(wideMath.scrolled > 0 && wideMath.scrolledWidth > wideMath.scrolledClient, JSON.stringify(wideMath));
    await writeFile(join(output, "math-narrow.png"), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`document.querySelector('[class*="history"]').scrollTop = 0`);
    await frames(window);
    await writeFile(join(output, "markdown-narrow.png"), (await window.webContents.capturePage()).toPNG());
    await window.webContents.executeJavaScript(`(() => {
      const h = document.querySelector('[class*="history"]'); h.scrollTop = h.scrollHeight;
    })()`);
    await frames(window);
    assert.ok(await window.webContents.executeJavaScript(`(() => {
      const last = [...document.querySelectorAll('article')].at(-1).getBoundingClientRect();
      const composer = document.querySelector('form').getBoundingClientRect();
      const area = document.querySelector('[class*="inputArea"]');
      const rect = area.getBoundingClientRect();
      return last.bottom <= composer.top && area.contains(document.elementFromPoint(rect.left + 2, rect.top + 10));
    })()`));
    assert.deepEqual(errors, []);
    const settled = { formulas: mathState.formulas, inline: mathState.inline, display: mathState.display, errors: mathState.errors.length };
    const report = { passed: true, narrow, settled, wideMath, errors };
    await writeFile(join(output, "markdown-results.json"), JSON.stringify(report, null, 2));
    process.stdout.write(JSON.stringify(report) + "\n");
  } finally {
    ipcMain.removeHandler("markdown:start");
    ipcMain.removeHandler("markdown:cancel");
    window.destroy();
  }
}

async function frames(window: BrowserWindow): Promise<void> {
  await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}

async function waitFor(window: BrowserWindow, expression: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await new Promise((resolveWait) => setTimeout(resolveWait, 30));
  }
  throw new Error(`Timed out: ${expression}`);
}

void main().then(() => app.exit(0), (error: unknown) => { console.error(error); app.exit(1); });
