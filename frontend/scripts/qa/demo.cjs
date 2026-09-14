const { app, BrowserWindow } = require("electron");
const { resolve } = require("node:path");
const { writeFile } = require("node:fs/promises");
const assert = require("node:assert/strict");

const pause = (ms) => new Promise((done) => setTimeout(done, ms));
let window;
const errors = [];
app.on("window-all-closed", () => {});

async function waitFor(expression, timeout = 5_000) {
  const deadline = Date.now() + timeout;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(expression)) return;
    await pause(40);
  }
  throw new Error(`Timed out: ${expression}`);
}

async function snapshot() {
  return window.webContents.executeJavaScript(`(() => {
    const label = document.querySelector('[class*="activityLabel"][data-active="true"]');
    const style = label && getComputedStyle(label);
    return { text: document.body.innerText, activeCount: document.querySelectorAll('[data-active="true"]').length,
      animation: style?.animationName, position: style?.backgroundPosition,
      iconTransform: document.querySelector('[class*="sweep"]') ? getComputedStyle(document.querySelector('[class*="sweep"]')).transform : null,
      iconMasks: document.querySelectorAll('mask').length,
      reducedMotion: matchMedia('(prefers-reduced-motion: reduce)').matches,
      expanded: document.querySelector('[class*="processBoundary"]')?.getAttribute('aria-expanded'),
      height: document.querySelector('[class*="processCollapse"]')?.getBoundingClientRect().height,
      overflow: document.documentElement.scrollWidth > innerWidth };
  })()`);
}

(async () => {
  await app.whenReady();
  window = new BrowserWindow({ width: 1100, height: 950, show: false,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, backgroundThrottling: false } });
  window.webContents.on("console-message", (event) => {
    if (event.level === "error") errors.push(event.message);
  });
  await window.loadFile(resolve("qa-output/messages.html"));
  window.showInactive();
  await waitFor(`document.querySelector('[class*="activityLabel"][data-active="true"]') !== null`);
  const active = await snapshot();
  await pause(500);
  const activeLater = await snapshot();
  assert.ok(active.text.includes("执行Shell"));
  assert.ok(active.text.includes("/hello"));
  assert.ok(active.activeCount >= 3);
  if (!active.reducedMotion) {
    assert.notEqual(active.animation, "none");
    assert.notEqual(activeLater.position, active.position);
    assert.notEqual(activeLater.iconTransform, active.iconTransform);
    assert.ok(active.iconMasks >= 2);
  }
  await writeFile(resolve("qa-output/demo-active.png"), (await window.webContents.capturePage()).toPNG());
  const icons = await window.webContents.executeJavaScript(`Array.from(document.querySelectorAll('[data-icon]')).map(node => node.dataset.icon)`);
  for (const icon of ['brain', 'globe', 'terminal', 'book', 'pen']) assert.ok(icons.includes(icon));
  const fileButtons = await window.webContents.executeJavaScript(`['read','edit','write'].map(name => document.querySelector('[aria-label="工具调用 ' + name + '"]').querySelectorAll('button').length)`);
  assert.deepEqual(fileButtons, [0, 0, 0]);
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[aria-label="工具调用 shell"]').querySelector('button') === null`), true);
  await window.webContents.executeJavaScript(`document.getElementById('finish').click()`);
  await waitFor(`document.querySelector('[class*="processBoundary"]').getAttribute('aria-expanded') === 'false'`);
  const complete = await snapshot();
  assert.ok(complete.text.includes("检查结论"));
  assert.ok(complete.text.includes("失败"));
  assert.ok(complete.text.includes("已取消"));
  assert.equal(complete.activeCount, 0);
  assert.equal(complete.iconMasks, 0);
  assert.equal(complete.height, 0);
  await window.webContents.executeJavaScript(`document.querySelector('[class*="processBoundary"]').click()`);
  await pause(450);
  const expanded = await snapshot();
  assert.equal(expanded.expanded, "true");
  assert.ok(expanded.text.includes("先把任务拆成两部分"));
  assert.ok(expanded.text.includes("已找到相关资料"));
  assert.ok(expanded.text.includes("执行Shell"));
  await window.webContents.executeJavaScript(`document.querySelector('[aria-label="工具调用 shell"] button').click()`);
  await pause(400);
  const output = await window.webContents.executeJavaScript(`(() => {
    const tool = document.querySelector('[aria-label="工具调用 shell"]');
    const label = tool.querySelector('[class*="activityLabel"]');
    const pre = tool.querySelector('pre');
    const command = tool.querySelector('[class*="toolCommand"]');
    const commandTop = command.getBoundingClientRect().top;
    pre.scrollTop = 100;
    const commandPinned = command.getBoundingClientRect().top === commandTop;
    const icon = tool.querySelector('[class*="activityIcon"]');
    tool.scrollIntoView({ block: 'center' });
    return { expanded: tool.querySelector('button').getAttribute('aria-expanded'),
      fullCommand: command.textContent, commandPinned,
      iconColor: getComputedStyle(icon).color, expectedIconColor: getComputedStyle(document.querySelector('[class*="reasoningText"]')).color,
      text: tool.innerText, command: label.title, ellipsis: getComputedStyle(label).textOverflow,
      clipped: label.scrollWidth > label.clientWidth, verticalScroll: pre.scrollHeight > pre.clientHeight,
      horizontalScroll: pre.scrollWidth > pre.clientWidth };
  })()`);
  assert.equal(output.expanded, "true");
  assert.equal(output.ellipsis, "ellipsis");
  assert.equal(output.clipped, true);
  assert.equal(output.verticalScroll, true);
  assert.equal(output.horizontalScroll, true);
  assert.ok(output.text.includes('退出码 1'));
  assert.ok(!output.text.includes('timeoutMs'));
  assert.ok(output.command.includes('--testNamePattern'));
  assert.equal(output.fullCommand, '$ ' + output.command.replace('执行Shell : ', ''));
  assert.equal(output.commandPinned, true);
  assert.equal(output.iconColor, output.expectedIconColor);
  await writeFile(resolve("qa-output/demo-shell.png"), (await window.webContents.capturePage()).toPNG());
  window.setSize(420, 900);
  await pause(300);
  const narrow = await snapshot();
  assert.equal(narrow.overflow, false);
  await writeFile(resolve("qa-output/demo-narrow.png"), (await window.webContents.capturePage()).toPNG());
  await window.webContents.executeJavaScript(`document.getElementById('replay').click()`);
  await waitFor(`document.querySelector('[class*="reasoningText"]')?.textContent.length > 0`);
  const first = await window.webContents.executeJavaScript(`document.querySelector('[class*="reasoningText"]').textContent`);
  await pause(500);
  const second = await window.webContents.executeJavaScript(`document.querySelector('[class*="reasoningText"]').textContent`);
  assert.ok(second.length > first.length);
  assert.ok(second.startsWith(first));
  assert.equal(await window.webContents.executeJavaScript(`document.querySelector('[data-icon="brain"] mask') !== null`), true);
  await waitFor(`document.querySelector('[class*="processBoundary"]').getAttribute('aria-expanded') === 'false'`, 40_000);
  await pause(450);
  const replayed = await snapshot();
  assert.ok(replayed.text.includes("检查结论"));
  assert.equal(replayed.height, 0);
  assert.equal(replayed.activeCount, 0);
  assert.deepEqual(errors, []);
  await writeFile(resolve("qa-output/demo-results.json"), JSON.stringify({ active, activeLater, complete, expanded, icons, fileButtons, output, narrow, first, second, replayed, errors }, null, 2));
  console.log("Single HTML: live shimmer, streaming, collapse, details, notifications and narrow layout passed.");
  window.destroy();
  app.exit(0);
})().catch((error) => {
  console.error(error);
  app.exit(1);
});
