import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { tmpdir } from "node:os";
import { app, BrowserWindow } from "electron";
import { createServer } from "vite";
import react from "@vitejs/plugin-react";

const output = join(tmpdir(), "navo-f55-qa");
app.setPath("userData", join(tmpdir(), "navo-f55-electron-" + process.pid));

async function main(): Promise<void> {
  await app.whenReady();
  await mkdir(output, { recursive: true });
  const server = await createServer({ root: resolve("."), configFile: false, plugins: [react()], server: { host: "127.0.0.1", port: 5186, strictPort: true } });
  await server.listen();
  const window = new BrowserWindow({ width: 1280, height: 900, show: true, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const errors: string[] = [];
  window.webContents.on("console-message", event => { if (event.message.includes("Uncaught")) errors.push(event.message); });
  async function evaluate<T>(source: string): Promise<T> { return window.webContents.executeJavaScript(source); }
  async function wait(source: string): Promise<void> {
    const end = Date.now() + 15_000;
    while (Date.now() < end) { if (await evaluate<boolean>(source)) return; await new Promise(resolveDelay => setTimeout(resolveDelay, 100)); }
    throw new Error("QA condition failed: " + source);
  }
  async function click(source: string): Promise<void> { await evaluate(source + ".click()"); }
  const node = (id: string) => `document.querySelector('[data-node-id="${id}"]')`;
  const activeTitle = "document.querySelector('[aria-label=\"项目内会话\"] [data-active=\"true\"] button')?.getAttribute('title')";
  const reviewText = "document.querySelector('[aria-label=\"节点验收\"]')?.textContent";
  try {
    await window.loadURL("http://127.0.0.1:5186/scripts/qa/roadmap/index.html");
    await wait("document.querySelector('[data-ready=\"true\"]') !== null");
    assert.equal(await evaluate("document.querySelectorAll('[data-node-id]').length"), 6);
    await click(node("5"));
    await wait(activeTitle + ".includes('对比与综合结论')");
    await click("[...document.querySelectorAll('button')].find(b=>b.textContent==='更新快照')");
    await wait("document.querySelectorAll('[data-node-id]').length === 7");
    await wait(node("2") + ".textContent.includes('文献已提交')");
    assert.equal(await evaluate("document.querySelectorAll('canvas').length"), 1);
    await click(node("3"));
    await wait(activeTitle + ".includes('复现基线方法')");
    assert.equal(await evaluate("document.querySelector('[aria-label=\"节点详情\"]') === null"), true);
    await click(node("4"));
    await wait(reviewText + ".includes('确认完成') && " + reviewText + ".includes('退回修改')");
    await click(node("6"));
    await wait(activeTitle + ".includes('补充案例分析')");
    await click(node("5"));
    await click("[...document.querySelectorAll('button')].find(b=>b.textContent==='移除汇合节点')");
    await wait("document.querySelector('[aria-label=\"切换到 Main\"]')?.getAttribute('aria-pressed') === 'true'");
    await click("[...document.querySelectorAll('button')].find(b=>b.textContent==='中断观察')");
    await wait("document.querySelector('[role=\"alert\"]')?.textContent.includes('路线更新已中断')");
    await click("[...document.querySelectorAll('button')].find(b=>b.textContent==='重新连接')");
    await wait("!document.body.textContent.includes('路线更新已中断')");
    await click("[...document.querySelectorAll('button')].find(b=>b.textContent==='清空路线')");
    await wait("document.querySelectorAll('[data-node-id]').length === 0");
    await click("[...document.querySelectorAll('button')].find(b=>b.textContent==='恢复路线')");
    await wait("document.querySelectorAll('[data-node-id]').length === 6");
    await click(node("2"));
    await wait(activeTitle + ".includes('整理文献证据')");
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await writeFile(join(output, "wide.png"), (await window.webContents.capturePage()).toPNG());
    window.setContentSize(547, 800);
    await wait("innerWidth === 547 && document.documentElement.scrollWidth === 547");
    await wait("document.querySelector('[aria-label=\"项目会话面板\"]')?.getBoundingClientRect().top >= document.querySelector('[data-testid=\"roadmap\"]')?.getBoundingClientRect().bottom");
    await evaluate("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await writeFile(join(output, "narrow.png"), (await window.webContents.capturePage()).toPNG());
    await click("document.querySelector('#turn-count')");
    assert.equal(await evaluate("document.querySelector('#turn-count').textContent"), "0");
    assert.deepEqual(errors, []);
    await writeFile(join(output, "result.json"), JSON.stringify({ status: "passed", nodes: 6, modelCalls: 0, width: 547, errors }, null, 2));
    console.log("F5.5 QA passed: " + output);
  } finally { window.destroy(); await server.close(); }
}

void main().then(() => app.exit(0), error => { console.error(error); app.exit(1); });
