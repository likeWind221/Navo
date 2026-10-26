const { app, BrowserWindow } = require("electron");
const { mkdir, writeFile } = require("node:fs/promises");
const { resolve, join } = require("node:path");
const { tmpdir } = require("node:os");
const assert = require("node:assert/strict");

app.setPath("userData", join(tmpdir(), `navo-visual-${process.pid}`));
const output = resolve("qa-output/visual");
const pause = ms => new Promise(done => setTimeout(done, ms));

async function main() {
  await app.whenReady();
  await mkdir(output, { recursive: true });
  const window = new BrowserWindow({ width: 1640, height: 1040, show: false, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false } });
  const errors = [];
  window.webContents.on("console-message", event => { if (event.level === "error") errors.push(event.message); });
  const run = script => window.webContents.executeJavaScript(script);
  const waitFor = async script => {
    for (let attempt = 0; attempt < 100; attempt++) {
      if (await run(script)) return;
      await pause(100);
    }
    throw new Error(`Timed out: ${script}`);
  };
  const capture = async name => { await pause(300); await writeFile(join(output, name + ".png"), (await window.webContents.capturePage()).toPNG()); };
  try {
    await window.loadURL(process.env.NAVO_VISUAL_URL ?? "http://127.0.0.1:4186/?preview=project");
    window.showInactive();
    await waitFor("document.querySelector('[data-ready=true]') !== null");
    await run("Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('查看规划前空态')).click()");
    await waitFor("document.querySelectorAll('[data-node-id]').length === 0");
    await capture("empty");
    await run("Array.from(document.querySelectorAll('button')).find(button => button.textContent.includes('查看示例路线')).click()");
    await waitFor("document.querySelectorAll('[data-node-id]').length === 5 && document.querySelector('[data-ready=true]') !== null");
    const webgl = await run("document.querySelector('canvas').getContext('webgl2').getParameter(WebGL2RenderingContext.VERSION)");
    const positions = () => run("Array.from(document.querySelectorAll('[data-node-id]')).map(node => ({ id: node.dataset.nodeId, transform: node.style.transform, hidden: node.hidden }))");
    const initial = await positions();
    assert(initial.some(node => !node.hidden));
    await run("document.querySelector('[data-testid=node-papers]').click()");
    await waitFor("document.querySelector('[aria-label=项目会话面板]').innerText.includes('Node 02')");
    await capture("project");
    const area = await run("(() => { const r = document.querySelector('canvas').getBoundingClientRect(); return { x: Math.round(r.x + r.width * .18), y: Math.round(r.y + r.height * .22) }; })()");
    window.webContents.sendInputEvent({ type: "mouseDown", button: "left", x: area.x, y: area.y, clickCount: 1 });
    window.webContents.sendInputEvent({ type: "mouseMove", button: "left", x: area.x + 130, y: area.y + 35, movementX: 130, movementY: 35 });
    window.webContents.sendInputEvent({ type: "mouseUp", button: "left", x: area.x + 130, y: area.y + 35, clickCount: 1 });
    await pause(200);
    const rotated = await positions();
    assert.notDeepEqual(rotated.map(node => node.transform), initial.map(node => node.transform));
    await capture("rotated");
    await run("document.querySelector('[aria-label=放大地图]').click()");
    await pause(100);
    const zoomed = await positions();
    assert.notDeepEqual(zoomed.map(node => node.transform), rotated.map(node => node.transform));
    window.webContents.sendInputEvent({ type: "mouseDown", button: "right", x: area.x, y: area.y, clickCount: 1 });
    window.webContents.sendInputEvent({ type: "mouseMove", button: "right", x: area.x + 45, y: area.y, movementX: 45, movementY: 0 });
    window.webContents.sendInputEvent({ type: "mouseUp", button: "right", x: area.x + 45, y: area.y, clickCount: 1 });
    await pause(100);
    const panned = await positions();
    assert.notDeepEqual(panned.map(node => node.transform), zoomed.map(node => node.transform));
    await run("document.querySelector('[aria-label=回到工作节点]').click()");
    await pause(100);
    await run("window.visualCanvas = document.querySelector('canvas'); Array.from(document.querySelectorAll('button')).find(button => button.textContent === '新增岛屿').click()");
    await waitFor("document.querySelectorAll('[data-node-id]').length === 6 && document.querySelector('[data-node-id=explore-1]').style.transform !== ''");
    const growth = await run("({ count: document.querySelectorAll('[data-node-id]').length, canvasPreserved: document.querySelector('canvas') === window.visualCanvas })");
    assert(await run("document.querySelector('canvas') === window.visualCanvas"));
    await capture("islands-added");
    await run("document.querySelector('[data-node-id=explore-1]').click()");
    await waitFor("document.querySelector('[aria-label=项目会话面板]').innerText.includes('Node 06')");
    await run("Array.from(document.querySelectorAll('button')).find(button => button.textContent === '移除末岛').click()");
    await waitFor("document.querySelectorAll('[data-node-id]').length === 5 && document.querySelector('[aria-label=项目会话面板]').innerText.includes('MAIN AGENT')");
    const removal = await run("({ count: document.querySelectorAll('[data-node-id]').length, canvasPreserved: document.querySelector('canvas') === window.visualCanvas })");
    assert(await run("document.querySelector('canvas') === window.visualCanvas"));
    await capture("islands-removed");
    await run("document.querySelector('[aria-label=完全展开会话面板]').click()");
    await capture("expanded");
    await run("document.querySelector('[aria-label=恢复普通宽度]').click()");
    window.setSize(420, 860);
    await pause(300);
    assert(await run("document.documentElement.scrollWidth <= innerWidth"));
    assert.equal(await run("document.querySelector('aside[aria-hidden]').getAttribute('aria-hidden')"), "true");
    await capture("narrow");
    await run("document.querySelector('[aria-label=收起会话面板]').click()");
    await capture("narrow-map");
    await run("document.querySelector('[aria-label=展开会话面板]').click()");
    assert(await run("document.querySelector('[aria-label=项目会话面板]') !== null"));
    for (let index = 0; index < 5; index++) await run("Array.from(document.querySelectorAll('button')).find(button => button.textContent === '移除末岛').click()");
    await waitFor("document.querySelectorAll('[data-node-id]').length === 0 && document.body.innerText.includes('还没有节点岛屿')");
    await capture("islands-empty");
    await run("Array.from(document.querySelectorAll('button')).find(button => button.textContent === '新增岛屿').click()");
    await waitFor("document.querySelectorAll('[data-node-id]').length === 1 && document.querySelector('[data-node-id]').style.transform !== ''");
    assert(await run("document.querySelector('canvas') === window.visualCanvas"));
    await run("document.querySelector('[aria-label=收起会话面板]').click()");
    window.setSize(1320, 900);
    await capture("island-detail");
    window.setSize(1320, 900);
    await window.loadURL("http://127.0.0.1:4186/");
    await waitFor("document.querySelector('#chat-input') !== null");
    await capture("chat");
    const typography = await run("(() => { const t = getComputedStyle(document.querySelector('textarea')); return { font: t.fontFamily, fontSize: t.fontSize, color: t.color }; })()");
    assert.deepEqual(errors, []);
    await writeFile(join(output, "results.json"), JSON.stringify({ webgl, initial, rotated, zoomed, panned, growth, removal, typography, errors }, null, 2));
    console.log("Visual QA passed: real WebGL2, orbit/zoom/pan, island growth/removal, persistent canvas, empty-to-single recovery, node conversation, narrow layout and chat.");
    app.exit(0);
  } catch (error) {
    await capture("failure");
    console.error(JSON.stringify(errors));
    console.error(error);
    app.exit(1);
  }
}

main().catch(error => { console.error(error); app.exit(1); });
