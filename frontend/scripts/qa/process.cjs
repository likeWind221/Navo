const { mkdir, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const assert = require("node:assert/strict");
const { app, BrowserWindow, ipcMain } = require("electron");

const START_CHANNEL = "navo:agent-turn:start";
const UPDATE_CHANNEL = "navo:agent-turn:update";
const outputDirectory = resolve("qa-output");
app.setPath("userData", join(tmpdir(), `navo-f4-2-qa-${process.pid}`));

const processEvents = (requestId) => {
  const scope = { sessionId: "local-session", requestId, turnId: "qa-turn" };
  const step = { ...scope, stepId: "qa-step", messageId: "qa-message" };
  return [
    { ...scope, type: "turn-started" },
    { ...step, type: "step-started" },
    { ...step, type: "content-started", contentIndex: 0, kind: "reasoning" },
    { ...step, type: "content-delta", contentIndex: 0, delta: "先读一下目录，再决定下一步。" },
    { ...step, type: "content-completed", contentIndex: 0 },
    { ...step, type: "content-started", contentIndex: 1, kind: "tool-call", toolCallId: "qa-tool", toolName: "read" },
    { ...step, type: "content-delta", contentIndex: 1, delta: "{\"path\":\"src/app.ts\"}" },
    { ...step, type: "content-completed", contentIndex: 1 },
    { ...step, type: "tool-started", contentIndex: 1, toolCallId: "qa-tool" },
    {
      ...step, type: "tool-result", contentIndex: 1, toolCallId: "qa-tool",
      status: "succeeded", summary: "读取完成", detail: "内容",
    },
  ];
};
const answerEvents = (requestId) => {
  const scope = { sessionId: "local-session", requestId, turnId: "qa-turn" };
  const step = { ...scope, stepId: "qa-step", messageId: "qa-message" };
  return [
    { ...step, type: "content-started", contentIndex: 2, kind: "text" },
    { ...step, type: "content-delta", contentIndex: 2, delta: "最终回答：配置在 src/app.ts。" },
    { ...step, type: "content-completed", contentIndex: 2 },
    { ...scope, type: "turn-completed" },
  ];
};

const snapshot = `(() => {
  const article = [...document.querySelectorAll('article[class*="assistantMessage"]')].at(-1);
  const header = article?.querySelector('[class*="processHeader"]');
  const body = article?.querySelector('[class*="processBody"]');
  const chevron = header?.querySelector('svg');
  return {
    headerLabel: header?.textContent?.trim() ?? '',
    expanded: header?.getAttribute('aria-expanded') ?? null,
    bodyVisible: body ? body.getClientRects().length > 0 : false,
    bodyHeight: body ? Math.round(body.getBoundingClientRect().height) : 0,
    chevronTransform: chevron ? getComputedStyle(chevron).transform : '',
    text: article?.textContent ?? '',
    answerVisible: (() => {
      const node = [...(article?.querySelectorAll('div') ?? [])]
        .find((item) => item.textContent?.includes('最终回答：配置在 src/app.ts。'));
      return node ? node.getClientRects().length > 0 : false;
    })(),
    overflow: article ? article.scrollWidth > article.clientWidth : false,
  };
})()`;

let window = null;
let acceptedRequestId = null;
const delay = (ms) => new Promise((done) => setTimeout(done, ms));
const send = (event) => window.webContents.send(UPDATE_CHANNEL, { type: "turn-event", event });
const push = async (events, gap = 30) => {
  for (const event of events) {
    send(event);
    await delay(gap);
  }
};

(async () => {
  await app.whenReady();
  await mkdir(outputDirectory, { recursive: true });
  await rm(join(outputDirectory, "f4-2-error.txt"), { force: true });

  ipcMain.handle(START_CHANNEL, (_event, input) => {
    acceptedRequestId = input.requestId;
    void push(processEvents(acceptedRequestId));
    return { type: "accepted" };
  });

  window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    backgroundColor: "#f4f1ea",
    webPreferences: {
      preload: resolve("out/preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });
  await window.loadFile(resolve("out/renderer/index.html"));
  window.show();
  window.focus();
  window.webContents.on("console-message", (_event, _level, message) => {
    process.stderr.write(`[renderer] ${message}\n`);
  });

  await window.webContents.executeJavaScript(`(async () => {
    const textarea = document.querySelector('#chat-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, '帮我看一下配置在哪里');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(requestAnimationFrame);
    textarea.form.requestSubmit();
    await new Promise(requestAnimationFrame);
  })()`);

  await waitFor(`document.querySelector('[class*="processHeader"]')?.getAttribute('aria-expanded') === 'true'`);
  await waitFor(`document.querySelector('article[class*="assistantMessage"]')?.textContent?.includes('读取完成')`);
  const streaming = await window.webContents.executeJavaScript(snapshot);
  assert.equal(streaming.bodyVisible, true);
  assert.equal(streaming.headerLabel, "处理中");
  assert.ok(streaming.text.includes("先读一下目录"));
  assert.ok(streaming.text.includes("read"));
  await window.webContents.executeJavaScript(`document.querySelector('[class*="processHeader"]').click()`);
  await delay(120);
  const streamingAfterClick = await window.webContents.executeJavaScript(snapshot);
  assert.equal(streamingAfterClick.bodyVisible, true, "生成中不允许折叠");
  await window.webContents.executeJavaScript(`document.querySelector('[class*="processHeader"]').click()`);
  await delay(120);
  await writeFile(join(outputDirectory, "f4-2-streaming.png"), (await window.webContents.capturePage()).toPNG());

  await push(answerEvents(acceptedRequestId));
  await waitFor(`document.querySelector('[class*="processHeader"]')?.getAttribute('aria-expanded') === 'false'`);
  await delay(250);
  const folded = await window.webContents.executeJavaScript(snapshot);
  assert.match(folded.headerLabel, /^已处理 \d+s$/);
  assert.equal(folded.bodyVisible, false);
  assert.equal(folded.chevronTransform, "none");
  assert.equal(folded.answerVisible, true);
  await writeFile(join(outputDirectory, "f4-2-folded.png"), (await window.webContents.capturePage()).toPNG());

  await window.webContents.executeJavaScript(`document.querySelector('[class*="processHeader"]').click()`);
  await delay(250);
  const expanded = await window.webContents.executeJavaScript(snapshot);
  assert.equal(expanded.bodyVisible, true);
  assert.notEqual(expanded.chevronTransform, "none");
  assert.ok(expanded.bodyHeight > 0);
  await writeFile(join(outputDirectory, "f4-2-expanded.png"), (await window.webContents.capturePage()).toPNG());

  const result = { streaming, streamingAfterClick, folded, expanded };
  await writeFile(join(outputDirectory, "f4-2-results.json"), JSON.stringify(result, null, 2));
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  window.destroy();
  app.quit();
})().catch(async (error) => {
  await mkdir(outputDirectory, { recursive: true });
  try {
    const page = await window.webContents.executeJavaScript("document.body.innerText.slice(0, 800)");
    process.stderr.write(`[page]\n${page}\n`);
  } catch {
    process.stderr.write("[page] unavailable\n");
  }
  await writeFile(join(outputDirectory, "f4-2-error.txt"), String(error?.stack ?? error));
  process.exitCode = 1;
  app.quit();
});

async function waitFor(expression) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await delay(30);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}
