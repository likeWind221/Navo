const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");

app.setPath("userData", join(tmpdir(), `navo-f71-${process.pid}`));
const output = resolve(process.env.NAVO_F71_OUTPUT ?? join(tmpdir(), `navo-f71-evidence-${process.pid}`));
const url = process.env.NAVO_F71_URL ?? "http://127.0.0.1:4186/?preview=resource";
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));

async function main() {
  await app.whenReady();
  await mkdir(output, { recursive: true });
  const window = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const errors = [];
  window.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
  const run = script => window.webContents.executeJavaScript(script);
  const waitFor = async (script, limit = 120) => {
    for (let attempt = 0; attempt < limit; attempt++) {
      if (await run(`(() => Boolean(${script}))()`)) return;
      await pause(50);
    }
    throw new Error(`Timed out: ${script}`);
  };
  const settle = async () => { await run("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"); await pause(120); };
  const capture = async name => writeFile(join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  const rect = selector => run(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return null; const r = element.getBoundingClientRect(); const style = getComputedStyle(element); return { x: r.x, y: r.y, width: r.width, height: r.height, display: style.display, visibility: style.visibility, pointerEvents: style.pointerEvents, center: { x: r.left + r.width / 2, y: r.top + r.height / 2 } }; })()`);
  const nativeClick = async selector => {
    const value = await rect(selector);
    assert(value && value.width > 0 && value.height > 0, `not clickable: ${selector}`);
    window.focus();
    window.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(value.center.x), y: Math.round(value.center.y), movementX: 0, movementY: 0 });
    window.webContents.sendInputEvent({ type: "mouseDown", button: "left", x: Math.round(value.center.x), y: Math.round(value.center.y), clickCount: 1 });
    window.webContents.sendInputEvent({ type: "mouseUp", button: "left", x: Math.round(value.center.x), y: Math.round(value.center.y), clickCount: 1 });
    await settle();
  };
  const visibleHit = selector => run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return false; const r = e.getBoundingClientRect(); const style = getComputedStyle(e); const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2); return r.width > 0 && r.height > 0 && style.display !== "none" && style.visibility !== "hidden" && style.pointerEvents !== "none" && (hit === e || e.contains(hit)); })()`);
  const escape = async () => {
    window.focus(); window.webContents.focus();
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape", modifiers: [] });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape", modifiers: [] });
    await settle();
  };
  const section = id => `section[aria-label="项目 ${id} · 研究资料"]`;
  const library = id => `${section(id)} [aria-label="资料库"]`;
  const button = id => `${section(id)} button[title="打开资料库"]`;
  const text = selector => `(document.querySelector(${JSON.stringify(selector)})?.innerText ?? "")`;
  const hasText = (selector, value) => `${text(selector)}.includes(${JSON.stringify(value)})`;
  const openLibrary = async id => { await nativeClick(button(id)); await waitFor(`document.querySelector(${JSON.stringify(library(id))}) !== null`); };
  try {
    await window.loadURL(url);
    window.show();
    await waitFor("document.querySelector('[data-ready=true]') !== null");
    await waitFor(`document.querySelector(${JSON.stringify('nav[aria-label="项目列表"] button[title="项目 A · 研究资料"]')}) !== null`);

    await openLibrary("A");
    await waitFor(hasText(library("A"), "项目说明.md"));
    await settle();
    assert(await visibleHit(library("A")));
    await capture("wide-ready");
    const rootText = await run(`document.querySelector(${JSON.stringify(library("A"))}).innerText`);
    assert(rootText.includes("仅元数据") && rootText.includes("处理失败") && rootText.includes("尚未处理"));

    await nativeClick(`${library("A")} [aria-label="资料库内容"] button`);
    await waitFor(hasText(library("A"), "研究笔记.md"));
    await nativeClick(`${library("A")} [aria-label="资料库内容"] button[aria-pressed=false]`);
    await waitFor(hasText(section("A"), "正文状态"));
    await settle();
    const selectedA = await run(`document.querySelector(${JSON.stringify(library("A"))}).innerText`);
    assert(selectedA.includes("notes/研究笔记.md"));
    await capture("selected-info");
    assert.equal(await run("window.__f71.project('a').activeCount()"), 1);
    assert.equal(await run("window.__f71.project('a').listenerCount()"), 2);

    await run("window.__f71.project('a').update('f72-a-nested', '研究笔记·已更新.md')");
    await waitFor(hasText(library("A"), "研究笔记·已更新.md"));

    await nativeClick('nav[aria-label="项目列表"] button[title="项目 B · 研究资料"]');
    await waitFor(`document.querySelector(${JSON.stringify(section("B"))}) !== null`);
    await run("window.__f71.project('b').setEarlyError(true)");
    await openLibrary("B");
    await waitFor(hasText(library("B"), "项目说明.md"));
    await waitFor(`document.querySelector(${JSON.stringify(`${section("B")} [role=alert]`)}) !== null`);
    assert(!(await run(text(library("B")))).includes("研究笔记·已更新.md"));
    await run("window.__f71.project('b').setEarlyError(false)");
    await nativeClick(`${library("B")} [role=alert] button`);
    await waitFor(`document.querySelector(${JSON.stringify(`${section("B")} [role=alert]`)}) === null`);
    assert.equal(await run("window.__f71.project('b').activeCount()"), 1);
    assert.equal(await run("window.__f71.project('b').listenerCount()"), 2);
    await escape();
    await waitFor(`document.querySelector(${JSON.stringify(library("B"))}) === null`);

    await nativeClick('nav[aria-label="项目列表"] button[title="项目 A · 研究资料"]');
    await waitFor(hasText(library("A"), "研究笔记·已更新.md"));
    window.setContentSize(547, 860);
    await settle();
    const narrow = await rect(library("A"));
    assert(narrow && narrow.width >= 530 && narrow.height > 500, JSON.stringify(narrow));
    assert.equal(await run("document.documentElement.scrollWidth <= innerWidth"), true);
    assert(await visibleHit(library("A")));
    await capture("narrow-selected-info");

    await run("window.__f71.project('a').remove('f72-a-nested')");
    await waitFor(hasText(library("A"), "当前目录为空"));
    await nativeClick(`${library("A")} nav[aria-label="资料库路径"] button`);
    await nativeClick(`${library("A")} [aria-label="资料库内容"] button`);
    await waitFor(hasText(library("A"), "当前目录为空"));

    await escape();
    await waitFor(`document.querySelector(${JSON.stringify(library("A"))}) === null`);
    await nativeClick('header nav[aria-label="已打开的标签页"] button[aria-label="关闭 项目 A · 研究资料"]');
    await nativeClick('header nav[aria-label="已打开的标签页"] button[aria-label="关闭 项目 B · 研究资料"]');
    await waitFor("window.__f71.project('a').activeCount() === 0 && window.__f71.project('b').activeCount() === 0");
    const result = {
      narrow, projectA: { active: await run("window.__f71.project('a').activeCount()"), listeners: await run("window.__f71.project('a').listenerCount()"), cancelled: await run("window.__f71.project('a').cancelledIds()") },
      projectB: { active: await run("window.__f71.project('b').activeCount()"), listeners: await run("window.__f71.project('b').listenerCount()"), cancelled: await run("window.__f71.project('b').cancelledIds()") }, errors,
    };
    assert.equal(result.projectA.active, 0); assert.equal(result.projectA.listeners, 0); assert(result.projectA.cancelled.length > 0);
    assert.equal(result.projectB.active, 0); assert.equal(result.projectB.listeners, 0); assert(result.projectB.cancelled.length > 0);
    assert.deepEqual(errors, []);
    await writeFile(join(output, "results.json"), JSON.stringify(result, null, 2));
    console.log(`F7.1 controlled Electron QA passed: ${output}`);
    app.exit(0);
  } catch (error) {
    try { await capture("failure"); } catch {}
    await writeFile(join(output, "failure.json"), JSON.stringify({ error: String(error), errors }, null, 2));
    console.error(error);
    app.exit(1);
  }
}

main().catch(error => { console.error(error); app.exit(1); });
