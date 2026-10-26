const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const assert = require("node:assert/strict");

const output = resolve(process.env.NAVO_BUG037_OUTPUT ?? "qa-output/bug037");
const url = process.env.NAVO_BUG037_URL ?? "http://127.0.0.1:4186/?preview=project";
const expectFix = process.env.NAVO_BUG037_EXPECT_FIX === "1";
const pause = ms => new Promise(resolvePause => setTimeout(resolvePause, ms));

async function main() {
  app.setPath("userData", join(app.getPath("temp"), `navo-bug037-${process.pid}`));
  await app.whenReady();
  await mkdir(output, { recursive: true });
  const window = new BrowserWindow({
    width: 1320,
    height: 900,
    show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  });
  const run = script => window.webContents.executeJavaScript(script);
  const waitFor = async script => {
    for (let attempt = 0; attempt < 100; attempt += 1) {
      if (await run(script)) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${script}`);
  };
  const settle = async () => {
    await run("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
    await pause(120);
  };
  const capture = async name => {
    await settle();
    await writeFile(join(output, `${name}.png`), (await window.webContents.capturePage()).toPNG());
  };
  const measure = () => run(`(() => {
    const panel = document.querySelector('[aria-label="项目会话面板"]');
    const project = document.querySelector('article[aria-label^="项目 "]');
    const textarea = document.querySelector('textarea');
    const rect = element => {
      if (!element) return null;
      const value = element.getBoundingClientRect();
      return { x: value.x, y: value.y, width: value.width, height: value.height, right: value.right, bottom: value.bottom };
    };
    const panelRect = rect(panel);
    const textRect = rect(textarea);
    const hit = panelRect && panelRect.width > 0 && panelRect.height > 0
      ? document.elementFromPoint(panelRect.x + Math.min(panelRect.width - 1, 20), panelRect.y + Math.min(panelRect.height - 1, 20))
      : null;
    return {
      viewport: { width: innerWidth, height: innerHeight },
      document: { scrollWidth: document.documentElement.scrollWidth, scrollHeight: document.documentElement.scrollHeight },
      panel: panelRect,
      textarea: textRect,
      panelStyle: panel ? { position: getComputedStyle(panel).position, gridColumn: getComputedStyle(panel).gridColumn, gridRow: getComputedStyle(panel).gridRow, display: getComputedStyle(panel).display, visibility: getComputedStyle(panel).visibility } : null,
      project: rect(project),
      hit: hit ? { tag: hit.tagName, label: hit.getAttribute("aria-label") } : null,
    };
  })()`);
  const nativeClick = async selector => {
    const point = await run(`(() => { const element = document.querySelector(${JSON.stringify(selector)}); if (!element) return null; const r = element.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, width: r.width, height: r.height, disabled: element.disabled }; })()`);
    assert(point, `Missing clickable element: ${selector}`);
    assert(point.width > 0 && point.height > 0, `Element is not visible: ${selector}`);
    assert.equal(point.disabled, false, `Element is disabled: ${selector}`);
    window.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y, movementX: 0, movementY: 0 });
    window.webContents.sendInputEvent({ type: "mouseDown", button: "left", x: point.x, y: point.y, clickCount: 1 });
    window.webContents.sendInputEvent({ type: "mouseUp", button: "left", x: point.x, y: point.y, clickCount: 1 });
    await settle();
  };
  try {
    await window.loadURL(url);
    window.showInactive();
    await waitFor("document.querySelector('[data-ready=true]') !== null");
    await waitFor("document.querySelector('[aria-label=项目会话面板]') !== null");

    window.setSize(547, 860);
    await settle();
    const narrow = await measure();
    await capture("narrow");
    if (!expectFix) {
      await writeFile(join(output, "results.json"), JSON.stringify({ narrow, expectedFix: false }, null, 2));
      console.log(`BUG-037 before evidence captured; evidence: ${output}`);
      app.exit(0);
      return;
    }
    assert(narrow.panel && narrow.panel.width > 0, `Narrow panel is not visible: ${JSON.stringify(narrow)}`);
    assert(narrow.textarea && narrow.textarea.width > 0, `Narrow composer is not visible: ${JSON.stringify(narrow)}`);
    assert(narrow.document.scrollWidth <= narrow.viewport.width, `Narrow layout overflows: ${JSON.stringify(narrow)}`);
    await nativeClick('button[aria-label="收起会话面板"]');
    const collapsed = await measure();
    assert.equal(await run('document.querySelector("[aria-label=展开会话面板]") !== null'), true);
    await capture("collapsed");
    await nativeClick('button[aria-label="展开会话面板"]');
    await nativeClick('button[aria-label="完全展开会话面板"]');
    const expanded = await measure();
    assert(expanded.panel && expanded.panel.width > 0 && expanded.textarea.width > 0, `Expanded panel is not visible: ${JSON.stringify(expanded)}`);
    await capture("expanded");
    await nativeClick('button[aria-label="恢复普通宽度"]');
    const restored = await measure();
    assert(restored.panel && restored.panel.width > 0 && restored.textarea.width > 0, `Restored panel is not visible: ${JSON.stringify(restored)}`);
    await capture("restored");

    await run("document.querySelector('[data-testid=node-papers]').click()");
    await waitFor("document.querySelector('[aria-label=项目会话面板]').innerText.includes('Node 02')");
    const nodeDraft = '节点草稿保持';
    await run(`(() => { const input = document.querySelector('textarea'); const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set; setter.call(input, ${JSON.stringify(nodeDraft)}); input.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await settle();
    assert.equal(await run("document.querySelector('textarea').value"), nodeDraft);
    await nativeClick('button[aria-label="收起会话面板"]');
    await nativeClick('button[aria-label="展开会话面板"]');
    const retainedDraft = await run("document.querySelector('textarea').value");
    assert.equal(retainedDraft, nodeDraft);
    await nativeClick('button[aria-label="发送示例消息"]');
    assert.equal(await run("document.querySelector('textarea').value"), "");
    assert(await run(`document.querySelector('[aria-label="项目会话面板"]').innerText.includes(${JSON.stringify(nodeDraft)})`));
    window.setSize(1320, 900);
    await settle();
    const wide = await measure();
    assert(wide.panel && wide.panel.width > 0 && wide.textarea.width > 0, `Wide panel is not visible: ${JSON.stringify(wide)}`);
    assert(wide.document.scrollWidth <= wide.viewport.width, `Wide layout overflows: ${JSON.stringify(wide)}`);
    await capture("wide");
    const selected = await run("({ node: document.querySelector('[aria-label=项目会话面板]').innerText.includes('Node 02'), draft: document.querySelector('textarea').value })");
    await capture("after");
    await writeFile(join(output, "results.json"), JSON.stringify({ narrow, collapsed, expanded, restored, wide, selected: { ...selected, retainedDraft }, }, null, 2));
    console.log(`BUG-037 QA passed; evidence: ${output}`);
    app.exit(0);
  } catch (error) {
    await capture("failure").catch(() => undefined);
    console.error(error);
    app.exit(1);
  }
}

main().catch(error => { console.error(error); app.exit(1); });
