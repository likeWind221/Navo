const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");

app.setPath("userData", join(tmpdir(), `navo-f72-${process.pid}`));
const output = resolve(process.env.NAVO_F72_OUTPUT ?? join(tmpdir(), `navo-f72-evidence-${process.pid}`));
const url = process.env.NAVO_F72_URL ?? "http://127.0.0.1:4186/?preview=resource";
const pause = milliseconds => new Promise(resolvePause => setTimeout(resolvePause, milliseconds));

async function main() {
  await app.whenReady();
  await mkdir(output, { recursive: true });
  const window = new BrowserWindow({ width: 1280, height: 900, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const errors = [];
  window.webContents.on("console-message", event => { if (event.level >= 2) errors.push(event.message); });
  const run = script => window.webContents.executeJavaScript(script);
  const waitFor = async (script, limit = 160) => {
    for (let attempt = 0; attempt < limit; attempt++) { if (await run(`(() => Boolean(${script}))()`)) return; await pause(50); }
    throw new Error(`Timed out: ${script}`);
  };
  const settle = async () => { await run("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))"); await pause(120); };
  const text = selector => `(document.querySelector(${JSON.stringify(selector)})?.innerText ?? "")`;
  const rect = selector => run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return { x: r.x, y: r.y, width: r.width, height: r.height, display: s.display, visibility: s.visibility, pointerEvents: s.pointerEvents, center: { x: r.left + r.width / 2, y: r.top + r.height / 2 } }; })()`);
  const nativeClick = async selector => {
    const value = await rect(selector);
    assert(value && value.width > 0 && value.height > 0, `not clickable: ${selector}`);
    const hit = await run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); const hit = e && document.elementFromPoint(e.getBoundingClientRect().left + e.getBoundingClientRect().width / 2, e.getBoundingClientRect().top + e.getBoundingClientRect().height / 2); return { hit: hit?.outerHTML?.slice(0, 160) ?? null, target: e?.outerHTML?.slice(0, 160) ?? null, matches: hit === e || Boolean(hit && e?.contains(hit)) }; })()`);
    assert(hit?.matches, `native hit mismatch: ${selector} ${JSON.stringify(hit)}`);
    window.focus();
    window.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(value.center.x), y: Math.round(value.center.y), movementX: 0, movementY: 0 });
    window.webContents.sendInputEvent({ type: "mouseDown", button: "left", x: Math.round(value.center.x), y: Math.round(value.center.y), clickCount: 1 });
    window.webContents.sendInputEvent({ type: "mouseUp", button: "left", x: Math.round(value.center.x), y: Math.round(value.center.y), clickCount: 1 });
    await settle();
  };
  const nativePoint = async selector => {
    const value = await rect(selector);
    assert(value && value.width > 0 && value.height > 0, `not visible: ${selector}`);
    window.focus();
    window.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(value.center.x), y: Math.round(value.center.y), movementX: 0, movementY: 0 });
    window.webContents.sendInputEvent({ type: "mouseDown", button: "left", x: Math.round(value.center.x), y: Math.round(value.center.y), clickCount: 1 });
    window.webContents.sendInputEvent({ type: "mouseUp", button: "left", x: Math.round(value.center.x), y: Math.round(value.center.y), clickCount: 1 });
    await settle();
  };
  const clickText = async (container, value) => {
    const selector = await run(`(() => { const root = document.querySelector(${JSON.stringify(container)}); const e = root && [...root.querySelectorAll("button")].find(button => button.textContent.includes(${JSON.stringify(value)})); if (!e) return null; e.dataset.f72Target = "true"; return ${JSON.stringify(`${container} button[data-f72-target="true"]`)}; })()`);
    assert(selector, `not found: ${value}`);
    await nativeClick(selector);
    await run(`document.querySelector(${JSON.stringify(selector)})?.removeAttribute("data-f72-target")`);
  };
  const sendKey = keyCode => { window.focus(); window.webContents.focus(); window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers: [] }); window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers: [] }); };
  const typeText = value => { for (const character of value) window.webContents.sendInputEvent({ type: "char", keyCode: character }); };
  const replaceInput = async (selector, value) => { await nativeClick(selector); window.webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] }); window.webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] }); typeText(value); };
  const section = id => `section[aria-label="项目 ${id} · 研究资料"]`;
  const library = id => `${section(id)} [aria-label="资料库"]`;
  const projectButton = id => `nav[aria-label="项目列表"] button[title="项目 ${id} · 研究资料"]`;
  const openLibrary = async id => { await nativeClick(projectButton(id)); await waitFor(`document.querySelector(${JSON.stringify(section(id))})?.getAttribute("data-active") === "true"`); await nativeClick(`${section(id)} button[title="打开资料库"]`); await waitFor(`document.querySelector(${JSON.stringify(library(id))}) !== null`); };
  const capture = async name => writeFile(join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  const escape = async () => { sendKey("Escape"); await settle(); };
  try {
    await window.loadURL(url);
    window.show();
    await waitFor("document.querySelector('[data-ready=true]') !== null");
    await waitFor(`document.querySelector(${JSON.stringify(projectButton("A"))}) !== null`);
    await openLibrary("A");
    await waitFor(`${text(library("A"))}.includes("项目说明.md")`);
    await capture("wide-ready");

    await clickText(library("A"), "导入文件");
    await waitFor(`${text(library("A"))}.includes("导入笔记.md") && ${text(library("A"))}.includes("已完成")`);
    await waitFor(`${text(library("A"))}.includes("导入笔记.md")`);

    await run("window.__f72.project('a').setStartDelay(350)");
    await clickText(library("A"), "导入目录");
    await waitFor(`${text(library("A"))}.includes("导入目录")`);
    await escape();
    await waitFor(`document.querySelector(${JSON.stringify(library("A"))}) === null`);
    await pause(450);
    await openLibrary("A");
    await waitFor(`${text(library("A"))}.includes("导入目录/笔记.md") && ${text(library("A"))}.includes("已完成")`);

    await run("window.__f72.project('a').setStartDelay(5000)");
    await clickText(library("A"), "导入文件");
    await pause(300);
    await waitFor(`${text(library("A"))}.includes("取消")`);
    await clickText(`${library("A")} [aria-label="资料操作进度"]`, "取消");
    await waitFor(`${text(library("A"))}.includes("已取消")`);
    assert((await run("window.__f72.project('a').cancelledIds().length")) > 0);

    await clickText(library("A"), "新建文件夹");
    await waitFor("document.querySelector('dialog[aria-label=\"新建文件夹\"] input') !== null");
    await replaceInput('dialog[aria-label="新建文件夹"] input', "qa-folder"); await clickText('dialog[aria-label="新建文件夹"]', "创建");
    await waitFor(`${text(library("A"))}.includes("qa-folder")`);
    await nativeClick(`${library("A")} button[aria-label="操作文件夹 qa-folder"]`);
    await clickText('[role="group"][aria-label="文件夹操作 qa-folder"]', "移动");
    await replaceInput('dialog[aria-label="移动文件夹"] input', "qa-archive"); await clickText('dialog[aria-label="移动文件夹"]', "移动");
    await waitFor(`${text(library("A"))}.includes("qa-archive")`);

    await nativeClick(`${library("A")} [aria-label="资料库内容"] button[aria-pressed="false"]`);
    await clickText(`${library("A")} [aria-label^="资料信息："]`, "编辑");
    await waitFor("document.querySelector('dialog[aria-label=\"编辑资料信息\"]')?.matches(':modal') === true");
    await nativePoint(`${library("A")} nav[aria-label="资料库路径"] button`);
    assert.equal(await run("document.querySelector('dialog[aria-label=\"编辑资料信息\"]') !== null"), true);
    sendKey("Tab"); await settle();
    assert.equal(await run("document.activeElement?.closest('dialog[aria-label=\\\"编辑资料信息\\\"]') !== null"), true);
    await replaceInput('dialog[aria-label="编辑资料信息"] input', "保留的过期草稿.md");
    await run("window.__f72.project('a').update('f72-a-root', '外部更新.md')");
    await waitFor(`${text(library("A"))}.includes("外部更新.md")`);
    await clickText('dialog[aria-label="编辑资料信息"]', "保存");
    await waitFor(`${text(library("A"))}.includes("资料版本已变化")`);
    assert.equal(await run("document.querySelector('dialog[aria-label=\\\"编辑资料信息\\\"] input')?.value"), "保留的过期草稿.md");
    await escape();
    await waitFor("document.querySelector('dialog[aria-label=\"编辑资料信息\"]') === null");
    assert.equal(await run("document.activeElement?.textContent?.includes('编辑')"), true);
    await clickText(`${library("A")} [aria-label^="资料信息："]`, "编辑");
    await replaceInput('dialog[aria-label="编辑资料信息"] input', "项目说明-更新.md"); await clickText('dialog[aria-label="编辑资料信息"]', "保存");
    await waitFor(`${text(library("A"))}.includes("项目说明-更新.md")`);
    await clickText(`${library("A")} [aria-label^="资料信息："]`, "移动");
    await replaceInput('dialog[aria-label="移动资料"] input', "qa-archive"); await clickText('dialog[aria-label="移动资料"]', "移动");
    await waitFor(`${text(library("A"))}.includes("qa-archive/项目说明-更新.md")`);
    await clickText(`${library("A")} [aria-label^="资料信息："]`, "替换");
    await waitFor(`${text(library("A"))}.includes("替换资料")`);
    await clickText(`${library("A")} [aria-label^="资料信息："]`, "删除");
    await waitFor("document.querySelector('dialog[aria-label=\"删除资料\"]') !== null");
    await clickText('dialog[aria-label="删除资料"]', "确认删除");
    await waitFor(`!${text(library("A"))}.includes("项目说明-更新.md")`);

    await nativeClick(`${library("A")} button[aria-label="操作文件夹 notes"]`);
    await clickText('[role="group"][aria-label="文件夹操作 notes"]', "删除");
    await clickText('dialog[aria-label="删除文件夹"]', "继续");
    await waitFor("document.querySelector('dialog[aria-label=\"确认递归删除\"]') !== null");
    await clickText('dialog[aria-label="确认递归删除"]', "确认删除");
    await waitFor(`!${text(library("A"))}.includes("notes")`);

    await escape();
    await openLibrary("B");
    await clickText(library("B"), "导入文件");
    await waitFor(`${text(library("B"))}.includes("导入笔记.md") && ${text(library("B"))}.includes("已完成")`);
    assert(!(await run(text(library("B")))).includes("项目说明-更新.md"));
    await escape();
    await nativeClick(projectButton("A"));
    await waitFor(`document.querySelector(${JSON.stringify(section("A"))})?.getAttribute("data-active") === "true"`);
    await nativeClick(`${section("A")} button[title="打开资料库"]`);
    await waitFor(`${text(library("A"))}.includes("导入笔记.md")`);
    window.setContentSize(547, 860);
    await settle();
    const narrow = await rect(library("A"));
    assert(narrow && narrow.width >= 530 && narrow.height > 500, JSON.stringify(narrow));
    assert.equal(await run("document.documentElement.scrollWidth <= innerWidth"), true);
    await capture("narrow-operations");
    await escape();
    await nativeClick('header nav[aria-label="已打开的标签页"] button[aria-label="关闭 项目 A · 研究资料"]');
    await nativeClick('header nav[aria-label="已打开的标签页"] button[aria-label="关闭 项目 B · 研究资料"]');
    await waitFor("window.__f72.project('a').activeCount() === 0 && window.__f72.project('b').activeCount() === 0");
    const result = { narrow, projectA: { active: await run("window.__f72.project('a').activeCount()"), listeners: await run("window.__f72.project('a').listenerCount()"), cancelled: await run("window.__f72.project('a').cancelledIds()") }, projectB: { active: await run("window.__f72.project('b').activeCount()"), listeners: await run("window.__f72.project('b').listenerCount()"), cancelled: await run("window.__f72.project('b').cancelledIds()") }, errors, chooserBoundary: "chooseFiles/chooseDirectory/chooseReplacement are controlled fixture responses; native OS dialog interaction is not covered." };
    assert.equal(result.projectA.active, 0); assert.equal(result.projectA.listeners, 0); assert.equal(result.projectB.active, 0); assert.equal(result.projectB.listeners, 0); assert.deepEqual(errors, []);
    await writeFile(join(output, "results.json"), JSON.stringify(result, null, 2));
    console.log(`F7.2 controlled Electron QA passed: ${output}`);
    app.exit(0);
  } catch (error) {
    try { await capture("failure"); } catch {}
    let fixture = null;
    try { fixture = await run("({ cancelled: window.__f72.project('a').cancelledIds(), imports: window.__f72.project('a').importIds(), active: window.__f72.project('a').activeCount(), delay: window.__f72.project('a').startDelay(), text: document.querySelector('section[aria-label=\\\"项目 A · 资料库\\\"]')?.innerText ?? '' })"); } catch {}
    await writeFile(join(output, "failure.json"), JSON.stringify({ error: String(error), errors, fixture }, null, 2));
    console.error(error);
    app.exit(1);
  }
}

main().catch(error => { console.error(error); app.exit(1); });
