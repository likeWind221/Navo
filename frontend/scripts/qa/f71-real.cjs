const { app, BrowserWindow, ipcMain } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const { join, resolve } = require("node:path");
const { pathToFileURL } = require("node:url");
const assert = require("node:assert/strict");

if (process.env.NAVO_F71_RUN_REAL !== "1") {
  console.error("Set NAVO_F71_RUN_REAL=1 to authorize the real zero-model Electron QA.");
  process.exitCode = 2;
} else {
  void main();
}

async function main() {
  const repoRoot = resolve(__dirname, "../../..");
  const evidenceRoot = resolve(process.env.NAVO_F71_REAL_OUTPUT ?? join(repoRoot, "..", "navo-f71-real-evidence"));
  const runRoot = join(evidenceRoot, `run-${Date.now()}`);
  const seedRoot = join(runRoot, "seed");
  const home = join(runRoot, "home");
  process.env.NAVO_REPO_ROOT = repoRoot;
  process.env.NAVO_HOME = home;
  process.env.NAVO_HOST_MODE = "real";
  process.env.LLM_PROVIDER = "qwen";
  process.env.LLM_MODEL = "f71-unused-model";
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
  const output = runRoot;
  const errors = [];
  const cancelCalls = [];
  let window;
  let stage = "initializing";
  const rendererPath = resolve(repoRoot, "frontend/out/renderer/index.html");
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
    return writeFile(join(output, `${name}.png`), image.toPNG());
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
  const text = selector => `(document.querySelector(${JSON.stringify(selector)})?.innerText ?? "")`;
  const section = name => `section[aria-label=${JSON.stringify(name)}]`;
  const library = name => `${section(name)} [aria-label="资料库"]`;
  const projectButton = name => `nav[aria-label="项目列表"] button[title=${JSON.stringify(name)}]`;
  const resourceButton = name => `${section(name)} button[title="打开资料库"]`;
  const waitForLoad = async () => {
    if (!window.webContents.isLoadingMainFrame()) return;
    await withTimeout(new Promise(resolveLoad => window.webContents.once("did-finish-load", resolveLoad)), 15_000, "did-finish-load");
  };
  const reloadPage = async () => {
    stage = "reload renderer bundle";
    let cleanup = () => {};
    const didFinishLoad = new Promise((resolveLoad, rejectLoad) => {
      const onFinish = () => { cleanup(); resolveLoad(); };
      const onFail = (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (isMainFrame === false) return;
        cleanup();
        rejectLoad(new Error(`did-fail-load ${errorCode}: ${errorDescription} (${validatedURL})`));
      };
      cleanup = () => {
        window.webContents.removeListener("did-finish-load", onFinish);
        window.webContents.removeListener("did-fail-load", onFail);
      };
      window.webContents.once("did-finish-load", onFinish);
      window.webContents.on("did-fail-load", onFail);
    });
    try {
      await withTimeout(Promise.all([window.loadFile(rendererPath), didFinishLoad]), 15_000, "loadFile renderer bundle");
    } finally {
      cleanup();
    }
  };
  const cancelHandler = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, listener) => channel === "navo:resource:cancel"
    ? cancelHandler(channel, async (event, input) => {
      const result = await listener(event, input);
      cancelCalls.push({ input, result });
      return result;
    })
    : cancelHandler(channel, listener);
  try {
    const seedA = await seedProject("QA A · 资料库", join(seedRoot, "a"));
    const seedB = await seedProject("QA B · 资料库", join(seedRoot, "b"));
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
    const events = await run(`(() => { window.__f71RealEvents = []; window.__f71RealUnsubscribe = window.desktop.resource.onEvent(event => window.__f71RealEvents.push(event)); return true; })()`);
    assert.equal(events, true);
    const a = await prepareProject(seedA);
    const b = await prepareProject(seedB);
    await writeFile(join(output, "seed.json"), JSON.stringify({ a, b, repoRoot, home }, null, 2));
    await reloadPage();
    await waitFor("window.desktop?.resource !== undefined");
    await run(`(() => { window.__f71RealEvents = []; window.__f71RealUnsubscribe = window.desktop.resource.onEvent(event => window.__f71RealEvents.push(event)); return true; })()`);
    await clickText('[aria-label="侧栏视图"]', "项目");
    await waitFor(`document.querySelector(${JSON.stringify(projectButton(a.name))}) !== null`);
    await openLibrary(a.name);
    await waitFor(`${text(library(a.name))}.includes("docs")`);
    await settle(); await capture("wide-ready");

    await clickText(`${library(a.name)} [aria-label="资料库内容"]`, "docs");
    await waitFor(`${text(library(a.name))}.includes("ready.md")`);
    const aDocs = await run(text(library(a.name)));
    assert(aDocs.includes("正文就绪") && aDocs.includes("仅元数据") && aDocs.includes("处理失败"));
    await clickText(`${library(a.name)} [aria-label="资料库内容"]`, "ready.md");
    await waitFor(`${text(library(a.name))}.includes("正文状态")`);
    await settle(); await capture("selected-info");
    assert((await run(text(library(a.name)))).includes("docs/ready.md"));

    await openLibrary(b.name);
    await waitFor(`${text(library(b.name))}.includes("docs")`);
    await clickText(`${library(b.name)} [aria-label="资料库内容"]`, "docs");
    await waitFor(`${text(library(b.name))}.includes("ready.md")`);
    await clickText(`${library(b.name)} [aria-label="资料库内容"]`, "ready.md");
    await nativeClick(projectButton(a.name));
    await waitFor(`${text(library(a.name))}.includes("docs/ready.md")`);
    assert((await run(text(library(a.name)))).includes("ready.md"));

    const updated = await invoke("resource", "update", { projectId: a.projectId, resourceId: a.readyId, expectedRevision: a.readyRevision, name: "ready-renamed.md", description: "QA 更新" });
    assert.equal(updated.type, "ok", JSON.stringify(updated));
    await waitFor(`${text(library(a.name))}.includes("ready-renamed.md")`);
    assert((await run(text(library(a.name)))).includes("QA 更新"));
    const deleted = await invoke("resource", "delete", { projectId: a.projectId, resourceId: a.readyId, expectedRevision: updated.value.revision, operationId: "f71-real-delete-a" });
    assert.equal(deleted.type, "ok", JSON.stringify(deleted));
    await waitFor(`!${text(library(a.name))}.includes("ready-renamed.md")`);
    await nativeClick(`${library(a.name)} nav[aria-label="资料库路径"] button`);
    await clickText(`${library(a.name)} [aria-label="资料库内容"]`, "empty");
    await waitFor(`${text(library(a.name))}.includes("当前目录为空")`);

    await nativeClick(`${library(a.name)} nav[aria-label="资料库路径"] button`);
    await clickText(`${library(a.name)} [aria-label="资料库内容"]`, "docs");
    await waitFor(`${text(library(a.name))}.includes("处理失败")`);
    await clickText(`${library(a.name)} [aria-label="资料库内容"]`, "empty.txt");
    await waitFor(`${text(library(a.name))}.includes("失败原因")`);

    await escape();
    await waitFor(`document.querySelector(${JSON.stringify(library(a.name))}) === null`);
    await nativeClick(projectButton(b.name));
    await escape();
    await waitFor(`document.querySelector(${JSON.stringify(library(b.name))}) === null`);
    await nativeClick(`nav[aria-label="已打开的标签页"] button[aria-label=${JSON.stringify(`关闭 ${a.name}`)}]`);
    await nativeClick(`nav[aria-label="已打开的标签页"] button[aria-label=${JSON.stringify(`关闭 ${b.name}`)}]`);
    await withTimeout((async () => {
      while (cancelCalls.length < 2) await pause(50);
    })(), 5_000, "resource follow cancellation ACK");
    const cancellation = cancelCalls.map(call => call.input);
    assert(cancelCalls.length >= 2 && cancelCalls.every(call => call.result?.type === "ok"));
    await writeFile(join(output, "result.json"), JSON.stringify({ a, b, cancellation, cancelCalls, viewport: await run("({ width: innerWidth, height: innerHeight })"), errors }, null, 2));
    assert.deepEqual(errors, []);
    console.log(`F7.1 formal Electron QA passed: ${output}`);
    await shutdown(0);
  } catch (error) {
    const diagnostics = window === undefined ? null : {
      url: window.webContents.getURL(), visible: window.isVisible(), minimized: window.isMinimized(),
      destroyed: window.isDestroyed(), loading: window.webContents.isLoadingMainFrame(),
    };
    await writeFile(join(output, "failure.json"), JSON.stringify({ stage, diagnostics, error: String(error), errors, cancelCalls }, null, 2));
    console.error(error);
    await shutdown(1);
  }

  async function invoke(scope, method, input) {
    return window.webContents.executeJavaScript(`window.desktop.${scope}.${method}(${JSON.stringify(input)})`);
  }

  async function prepareProject(seed) {
    const created = await invoke("project", "create", { name: seed.name, goal: "F7.1 formal library acceptance", workspaceRoot: seed.workspaceRoot });
    assert.equal(created.type, "ok", JSON.stringify(created));
    const projectId = created.value.projectId;
    for (const path of ["docs", "empty"]) {
      const folder = await invoke("resource", "createFolder", { projectId, path });
      assert.equal(folder.type, "ok", JSON.stringify(folder));
    }
    const imported = {};
    let importIndex = 0;
    for (const file of ["ready.md", "unknown.bin", "empty.txt"]) {
      const requestId = `f71-real-${projectId}-${++importIndex}`;
      const started = await invoke("resource", "startImport", { projectId, requestId, sources: [{ kind: "file", path: join(seed.workspaceRoot, file) }] });
      assert.equal(started.type, "ok", JSON.stringify(started));
      const subscriptionId = started.value.subscriptionId;
      await waitFor(`window.__f71RealEvents.some(event => event.type === 'import-item' && event.subscriptionId === ${JSON.stringify(subscriptionId)} && event.item.status === 'saved')`);
      const saved = await run(`window.__f71RealEvents.find(event => event.type === 'import-item' && event.subscriptionId === ${JSON.stringify(subscriptionId)} && event.item.status === 'saved')`);
      imported[file] = saved.item.resourceId;
      await waitFor(`window.__f71RealEvents.some(event => event.type === 'stream-complete' && event.subscriptionId === ${JSON.stringify(subscriptionId)})`);
    }
    const root = await invoke("resource", "browse", { projectId, path: null });
    assert.equal(root.type, "ok", JSON.stringify(root));
    const revisions = {};
    for (const file of Object.keys(imported)) {
      const item = root.value.resources.find(value => value.resourceId === imported[file]);
      assert(item, `imported resource missing: ${file}`);
      const updated = await invoke("resource", "update", { projectId, resourceId: item.resourceId, expectedRevision: item.revision, folder: "docs", description: `正式 QA · ${file}` });
      assert.equal(updated.type, "ok", JSON.stringify(updated));
      revisions[file] = updated.value.revision;
    }
    return { name: seed.name, workspaceRoot: seed.workspaceRoot, projectId, readyId: imported["ready.md"], readyRevision: revisions["ready.md"], emptyId: imported["empty.txt"] };
  }

  async function openLibrary(name) {
    await nativeClick(projectButton(name));
    await waitFor(`document.querySelector(${JSON.stringify(section(name))})?.getAttribute("data-active") === "true"`);
    await nativeClick(resourceButton(name));
    await waitFor(`document.querySelector(${JSON.stringify(library(name))}) !== null`);
  }

  async function clickText(container, value) {
    stage = `clickText:${value}`;
    const point = await window.webContents.executeJavaScript(`(() => { const root = document.querySelector(${JSON.stringify(container)}); const e = root && [...root.querySelectorAll("button")].find(button => button.textContent.includes(${JSON.stringify(value)})); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2 }; })()`);
    assert(point, `not found: ${value}`);
    window.focus();
    window.webContents.sendInputEvent({ type: "mouseDown", button: "left", x: Math.round(point.x), y: Math.round(point.y), clickCount: 1 });
    window.webContents.sendInputEvent({ type: "mouseUp", button: "left", x: Math.round(point.x), y: Math.round(point.y), clickCount: 1 });
    await settle(stage);
  }

  async function escape() {
    window.focus(); window.webContents.focus();
    window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Escape", modifiers: [] });
    window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Escape", modifiers: [] });
    await settle();
  }
}

async function seedProject(name, workspaceRoot) {
  await mkdir(join(workspaceRoot, "docs"), { recursive: true });
  await mkdir(join(workspaceRoot, "empty"), { recursive: true });
  await writeFile(join(workspaceRoot, "ready.md"), "# ready\n");
  await writeFile(join(workspaceRoot, "unknown.bin"), Buffer.from([0, 1, 2, 3]));
  await writeFile(join(workspaceRoot, "empty.txt"), "");
  return { name, workspaceRoot };
}

async function shutdown(code) {
  if (!app.isReady()) return;
  const quit = new Promise(resolveQuit => app.once("will-quit", () => {
    process.exitCode = code;
    resolveQuit(true);
    app.exit(code);
  }));
  app.quit();
  const completed = await Promise.race([quit.then(() => true), pause(10_000).then(() => false)]);
  if (!completed) {
    process.exitCode = 1;
    console.error("Electron quit timed out; leave the current run directory for process cleanup.");
  }
}

function pause(ms) { return new Promise(resolvePause => setTimeout(resolvePause, ms)); }
