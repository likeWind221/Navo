const { app, BrowserWindow, ipcMain } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");

if (process.env.NAVO_F72_RUN_REAL !== "1") {
  console.error("Set NAVO_F72_RUN_REAL=1 to authorize the real zero-model Electron QA.");
  process.exitCode = 2;
} else {
  void main();
}

async function main() {
  const repoRoot = resolve(__dirname, "../../..");
  const evidenceRoot = resolve(process.env.NAVO_F72_REAL_OUTPUT ?? join(repoRoot, "..", "navo-f72-real-evidence"));
  const runRoot = join(evidenceRoot, `run-${Date.now()}`);
  const seedRoot = join(runRoot, "seed");
  const home = join(runRoot, "home");
  process.env.NAVO_REPO_ROOT = repoRoot;
  process.env.NAVO_HOME = home;
  process.env.NAVO_HOST_MODE = "real";
  process.env.LLM_PROVIDER = "qwen";
  process.env.LLM_MODEL = "f72-unused-model";
  process.env.LLM_BASE_URL = "http://127.0.0.1:9/v1";
  delete process.env.LLM_API_KEY;
  delete process.env.EXA_API_KEY;
  delete process.env.OPENROUTER_API_KEY;
  for (const name of Object.keys(process.env)) {
    if (name.startsWith("EMBEDDING_") || name.startsWith("GRAPH_")) delete process.env[name];
  }
  delete process.env.ELECTRON_RENDERER_URL;
  app.setPath("userData", join(runRoot, "electron-user-data"));
  await mkdir(seedRoot, { recursive: true });
  await mkdir(home, { recursive: true });
  await writeFile(join(seedRoot, "ready.md"), "# ready\n");
  await writeFile(join(seedRoot, "note.md"), "# note\n");

  const errors = [];
  const cancelCalls = [];
  const chooser = { files: [], directory: [], replacement: null };
  let window;
  let stage = "initializing";
  const rendererPath = resolve(repoRoot, "frontend/out/renderer/index.html");
  const pause = milliseconds => new Promise(resolvePause => setTimeout(resolvePause, milliseconds));
  const withTimeout = async (promise, milliseconds, label) => Promise.race([
    promise,
    pause(milliseconds).then(() => { throw new Error(`Timed out after ${milliseconds}ms: ${label}`); }),
  ]);
  const run = script => window.webContents.executeJavaScript(script);
  const runWithTimeout = (script, label) => withTimeout(run(script), 5_000, label);
  const waitFor = async (script, limit = 240) => {
    const label = `waitFor ${script}`;
    for (let attempt = 0; attempt < limit; attempt++) {
      if (await runWithTimeout(`(() => Boolean(${script}))()`, label)) return;
      await pause(50);
    }
    throw new Error(`Timed out: ${script}`);
  };
  const settle = async (label = "paint") => {
    window.show(); window.focus(); window.webContents.focus();
    await waitFor("document.visibilityState === 'visible'", 40);
    await runWithTimeout("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))", `rAF ${label}`);
    await pause(150);
  };
  const capture = async name => {
    stage = `capture:${name}`;
    await settle(stage);
    const image = await withTimeout(window.webContents.capturePage(), 5_000, `capture ${name}`);
    return writeFile(join(runRoot, `${name}.png`), image.toPNG());
  };
  const rect = selector => run(`(() => { const e = document.querySelector(${JSON.stringify(selector)}); if (!e) return null; const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return { x: r.x, y: r.y, width: r.width, height: r.height, visibility: s.visibility, pointerEvents: s.pointerEvents, center: { x: r.left + r.width / 2, y: r.top + r.height / 2 } }; })()`);
  const nativeClick = async selector => {
    stage = `nativeClick:${selector}`;
    const value = await rect(selector);
    assert(value && value.width > 0 && value.height > 0, `not clickable: ${selector}`);
    window.focus();
    window.webContents.sendInputEvent({ type: "mouseMove", x: Math.round(value.center.x), y: Math.round(value.center.y), movementX: 0, movementY: 0 });
    window.webContents.sendInputEvent({ type: "mouseDown", button: "left", x: Math.round(value.center.x), y: Math.round(value.center.y), clickCount: 1 });
    window.webContents.sendInputEvent({ type: "mouseUp", button: "left", x: Math.round(value.center.x), y: Math.round(value.center.y), clickCount: 1 });
    await settle(stage);
  };
  const clickText = async (container, value) => {
    stage = `clickText:${value}`;
    const selector = await run(`(() => { const root = document.querySelector(${JSON.stringify(container)}); const e = root && [...root.querySelectorAll("button")].find(button => button.textContent.includes(${JSON.stringify(value)})); if (!e) return null; e.dataset.f72Real = "true"; return ${JSON.stringify(`${container} button[data-f72-real="true"]`)}; })()`);
    assert(selector, `not found: ${value}`);
    await run(`document.querySelector(${JSON.stringify(selector)})?.click()`);
    await settle(stage);
    await run(`document.querySelector(${JSON.stringify(selector)})?.removeAttribute("data-f72-real")`);
  };
  const sendKey = keyCode => { window.focus(); window.webContents.focus(); window.webContents.sendInputEvent({ type: "keyDown", keyCode, modifiers: [] }); window.webContents.sendInputEvent({ type: "keyUp", keyCode, modifiers: [] }); };
  const typeText = value => { for (const character of value) window.webContents.sendInputEvent({ type: "char", keyCode: character }); };
  const replaceInput = async (selector, value) => {
    await nativeClick(selector);
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "A", modifiers: ["control"] });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "A", modifiers: ["control"] });
    typeText(value);
    await settle();
  };
  const text = selector => `(document.querySelector(${JSON.stringify(selector)})?.innerText ?? "")`;
  const section = name => `section[aria-label=${JSON.stringify(name)}]`;
  const library = name => `${section(name)} [aria-label="资料库"]`;
  const content = name => `${library(name)} [aria-label="资料库内容"]`;
  const projectButton = name => `nav[aria-label="项目列表"] button[title=${JSON.stringify(name)}]`;
  const waitForLoad = async () => {
    if (!window.webContents.isLoadingMainFrame()) return;
    await withTimeout(new Promise(resolveLoad => window.webContents.once("did-finish-load", resolveLoad)), 15_000, "did-finish-load");
  };
  const reloadPage = async () => {
    stage = "reload renderer bundle";
    const didFinishLoad = new Promise((resolveLoad, rejectLoad) => {
      const onFinish = () => { cleanup(); resolveLoad(); };
      const onFail = (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (isMainFrame === false) return;
        cleanup();
        rejectLoad(new Error(`did-fail-load ${errorCode}: ${errorDescription} (${validatedURL})`));
      };
      const cleanup = () => {
        window.webContents.removeListener("did-finish-load", onFinish);
        window.webContents.removeListener("did-fail-load", onFail);
      };
      window.webContents.once("did-finish-load", onFinish);
      window.webContents.on("did-fail-load", onFail);
    });
    await withTimeout(Promise.all([window.loadFile(rendererPath), didFinishLoad]), 15_000, "loadFile renderer bundle");
  };
  const originalHandle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => {
    if (channel === "navo:resource:choose:files") {
      return originalHandle(channel, () => ({ type: "ok", value: chooser.files.map(path => ({ kind: "file", path })) }));
    }
    if (channel === "navo:resource:choose:directory") {
      return originalHandle(channel, () => ({ type: "ok", value: chooser.directory.map(path => ({ kind: "directory", path })) }));
    }
    if (channel === "navo:resource:choose:replacement") {
      return originalHandle(channel, () => ({ type: "ok", value: chooser.replacement }));
    }
    if (channel === "navo:resource:cancel") {
      return originalHandle(channel, async (event, input) => {
        const result = await listener(event, input);
        cancelCalls.push({ input, result });
        return result;
      });
    }
    return originalHandle(channel, listener);
  };
  try {
    await import(pathToFileURL(resolve(repoRoot, "frontend/out/main/index.js")).href);
    await app.whenReady();
    for (let attempt = 0; attempt < 100 && BrowserWindow.getAllWindows().length === 0; attempt++) await pause(50);
    window = BrowserWindow.getAllWindows()[0];
    assert(window, "formal App did not create a BrowserWindow");
    window.show();
    window.webContents.on("console-message", event => { if (event.level >= 2) errors.push({ level: event.level, message: event.message }); });
    stage = "initial renderer load";
    await waitForLoad();
    await waitFor("window.desktop?.resource !== undefined");
    await reloadPage();
    await waitFor("window.desktop?.resource !== undefined");
    const projectName = "QA F72 · 导入整理";
    const created = await invoke("project", "create", { name: projectName, goal: "F7.2 real import and organize acceptance", workspaceRoot: seedRoot });
    assert.equal(created.type, "ok", JSON.stringify(created));
    const projectId = created.value.projectId;
    await reloadPage();
    await waitFor("window.desktop?.resource !== undefined");
    await clickText('[aria-label="侧栏视图"]', "项目");
    await waitFor(`document.querySelector(${JSON.stringify(projectButton(projectName))}) !== null`);
    await openLibrary(projectName);
    await waitFor(`${text(library(projectName))}.includes("当前目录为空")`);
    await settle(); await capture("empty-library");

    chooser.files = [join(seedRoot, "ready.md"), join(seedRoot, "note.md")];
    await clickText(library(projectName), "导入文件");
    await waitFor(`${text(`${library(projectName)} [aria-label="资料操作进度"]`)}.includes("已完成")`);
    await waitFor(`${text(content(projectName))}.includes("ready.md") && ${text(content(projectName))}.includes("note.md")`);
    await settle(); await capture("imported");

    await clickText(library(projectName), "新建文件夹");
    await waitFor("document.querySelector('dialog[aria-label=\"新建文件夹\"] input') !== null");
    await replaceInput('dialog[aria-label="新建文件夹"] input', "qa-folder");
    await clickText('dialog[aria-label="新建文件夹"]', "创建");
    await waitFor(`${text(content(projectName))}.includes("qa-folder")`);

    await nativeClick(`${library(projectName)} button[aria-label="操作文件夹 qa-folder"]`);
    await clickText(`[role="group"][aria-label="文件夹操作 qa-folder"]`, "移动");
    await replaceInput('dialog[aria-label="移动文件夹"] input', "qa-archive");
    await clickText('dialog[aria-label="移动文件夹"]', "移动");
    await waitFor(`${text(content(projectName))}.includes("qa-archive")`);

    await nativeClick(`${library(projectName)} [aria-label="资料库内容"] button[aria-pressed="false"]`);
    await clickText(`${library(projectName)} [aria-label="资料库内容"]`, "note.md");
    await clickText(`${library(projectName)} [aria-label^="资料信息："]`, "删除");
    await waitFor("document.querySelector('dialog[aria-label=\"删除资料\"]') !== null");
    await clickText('dialog[aria-label="删除资料"]', "确认删除");
    await waitFor(`!${text(content(projectName))}.includes("note.md")`);

    await clickText(`${library(projectName)} [aria-label="资料库内容"]`, "ready.md");
    await clickText(`${library(projectName)} [aria-label^="资料信息："]`, "编辑");
    await waitFor("document.querySelector('dialog[aria-label=\"编辑资料信息\"]') !== null");
    await replaceInput('dialog[aria-label="编辑资料信息"] input', "stale.md");
    const rootBefore = await invoke("resource", "browse", { projectId, path: null });
    assert.equal(rootBefore.type, "ok", JSON.stringify(rootBefore));
    const edited = rootBefore.value.resources.find(item => item.name === "ready.md");
    assert(edited, "imported ready.md is missing");
    const external = await invoke("resource", "update", {
      projectId, resourceId: edited.resourceId, expectedRevision: edited.revision, name: "external.md",
    });
    assert.equal(external.type, "ok", JSON.stringify(external));
    await waitFor(`${text(content(projectName))}.includes("external.md")`);
    await clickText('dialog[aria-label="编辑资料信息"]', "保存");
    await waitFor(`${text(library(projectName))}.includes("资料版本已变化")`);
    assert.equal(await run("document.querySelector('dialog[aria-label=\\\"编辑资料信息\\\"] input')?.value"), "stale.md");
    await escape();
    await waitFor(`document.querySelector(${JSON.stringify(`${library(projectName)} [aria-label="资料信息：external.md"]`)}) !== null`);

    await clickText(`${library(projectName)} [aria-label^="资料信息："]`, "移动");
    await replaceInput('dialog[aria-label="移动资料"] input', "qa-archive");
    await clickText('dialog[aria-label="移动资料"]', "移动");
    await waitFor(`${text(content(projectName))}.includes("qa-archive")`);
    await clickText(`${library(projectName)} [aria-label="资料库内容"]`, "qa-archive");
    await waitFor(`${text(content(projectName))}.includes("external.md")`);
    await nativeClick(`${library(projectName)} nav[aria-label="资料库路径"] button`);
    await waitFor(`${text(content(projectName))}.includes("qa-archive")`);

    await nativeClick(`${library(projectName)} button[aria-label="操作文件夹 qa-archive"]`);
    await clickText(`[role="group"][aria-label="文件夹操作 qa-archive"]`, "删除");
    await clickText('dialog[aria-label="删除文件夹"]', "继续");
    await waitFor("document.querySelector('dialog[aria-label=\"确认递归删除\"]') !== null");
    await clickText('dialog[aria-label="确认递归删除"]', "确认删除");
    await waitFor(`!${text(content(projectName))}.includes("qa-archive")`);
    await settle(); await capture("organized");

    const finalRoot = await invoke("resource", "browse", { projectId, path: null });
    assert.equal(finalRoot.type, "ok", JSON.stringify(finalRoot));
    assert.equal(finalRoot.value.resources.some(item => item.name === "external.md"), false);
    assert.equal(finalRoot.value.directories.some(item => item.path === "qa-archive"), false);
    const result = { projectId, chooserBoundary: "chooseFiles/chooseDirectory/chooseReplacement are intercepted at the Electron IPC boundary; Host import, folder and resource mutations use the real bridge.", errors, cancelCalls };
    await writeFile(join(runRoot, "result.json"), JSON.stringify(result, null, 2));
    assert.deepEqual(errors, []);
    console.log(`F7.2 formal Electron QA passed: ${runRoot}`);
    await shutdown(0);
  } catch (error) {
    const diagnostics = window === undefined ? null : {
      url: window.webContents.getURL(), visible: window.isVisible(), minimized: window.isMinimized(),
      destroyed: window.isDestroyed(), loading: window.webContents.isLoadingMainFrame(),
    };
    await writeFile(join(runRoot, "failure.json"), JSON.stringify({ stage, diagnostics, error: String(error), errors, chooser, cancelCalls }, null, 2));
    try { await capture("failure"); } catch {}
    console.error(error);
    await shutdown(1);
  }

  async function invoke(scope, method, input) {
    return window.webContents.executeJavaScript(`window.desktop.${scope}.${method}(${JSON.stringify(input)})`);
  }

  async function openLibrary(name) {
    await nativeClick(projectButton(name));
    await waitFor(`document.querySelector(${JSON.stringify(section(name))})?.getAttribute("data-active") === "true"`);
    await nativeClick(`${section(name)} button[title="打开资料库"]`);
    await waitFor(`document.querySelector(${JSON.stringify(library(name))}) !== null`);
  }

  async function escape() {
    window.focus(); window.webContents.focus();
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape", modifiers: [] });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape", modifiers: [] });
    await settle();
  }
}

async function shutdown(code) {
  if (!app.isReady()) return;
  const quit = new Promise(resolveQuit => app.once("will-quit", () => {
    process.exitCode = code;
    resolveQuit(true);
    app.exit(code);
  }));
  app.quit();
  const completed = await Promise.race([quit.then(() => true), new Promise(resolvePause => setTimeout(() => resolvePause(false), 10_000))]);
  if (!completed) {
    process.exitCode = 1;
    console.error("Electron quit timed out; leave the current run directory for process cleanup.");
  }
}
