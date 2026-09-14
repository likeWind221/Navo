const { mkdir, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join, resolve } = require("node:path");
const assert = require("node:assert/strict");
const { app, BrowserWindow, ipcMain } = require("electron");

const START_CHANNEL = "navo:agent-turn:start";
const UPDATE_CHANNEL = "navo:agent-turn:update";
const outputDirectory = resolve("qa-output");
app.setPath("userData", join(tmpdir(), `navo-f4-4-qa-${process.pid}`));

const processEvents = (requestId) => {
  const scope = { sessionId: "local-session", requestId, turnId: "qa-turn" };
  const stepA = { ...scope, stepId: "qa-step-a", messageId: "qa-message-a" };
  const stepB = { ...scope, stepId: "qa-step-b", messageId: "qa-message-b" };
  return [
    { ...scope, type: "turn-started" },
    { ...stepA, type: "step-started" },
    { ...stepA, type: "content-started", contentIndex: 0, kind: "reasoning" },
    { ...stepA, type: "content-delta", contentIndex: 0, delta: "先检查现有结构。再决定下一步。" },
    { ...stepA, type: "content-completed", contentIndex: 0 },
    { ...stepA, type: "content-started", contentIndex: 1, kind: "tool-call", toolCallId: "qa-tool-a", toolName: "shell" },
    { ...stepA, type: "content-delta", contentIndex: 1, delta: "{\"command\":\"pnpm test\"}" },
    { ...stepA, type: "content-completed", contentIndex: 1 },
    { ...stepA, type: "tool-started", contentIndex: 1, toolCallId: "qa-tool-a" },
    { ...stepA, type: "tool-result", contentIndex: 1, toolCallId: "qa-tool-a", status: "succeeded", summary: "第一次执行完成", detail: "ok" },
    { ...stepB, type: "step-started" },
    { ...stepB, type: "content-started", contentIndex: 0, kind: "reasoning" },
    { ...stepB, type: "content-delta", contentIndex: 0, delta: "折叠边界应该放到最终回答之前。" },
    { ...stepB, type: "content-completed", contentIndex: 0 },
    { ...stepB, type: "content-started", contentIndex: 1, kind: "tool-call", toolCallId: "qa-tool-b", toolName: "shell" },
    { ...stepB, type: "content-delta", contentIndex: 1, delta: "{\"command\":\"pnpm build\"}" },
    { ...stepB, type: "content-completed", contentIndex: 1 },
    { ...stepB, type: "tool-started", contentIndex: 1, toolCallId: "qa-tool-b" },
    { ...stepB, type: "tool-result", contentIndex: 1, toolCallId: "qa-tool-b", status: "succeeded", summary: "ok", detail: "ok" },
  ];
};

const answerEvents = (requestId) => {
  const scope = { sessionId: "local-session", requestId, turnId: "qa-turn" };
  const step = { ...scope, stepId: "qa-step-final", messageId: "qa-message-final" };
  return [
    { ...step, type: "step-started" },
    { ...step, type: "content-started", contentIndex: 0, kind: "text" },
    { ...step, type: "content-delta", contentIndex: 0, delta: "最终回答：F4.4 布局已经完成。" },
    { ...step, type: "content-completed", contentIndex: 0 },
    { ...scope, type: "turn-completed" },
  ];
};

const snapshot = `(() => {
  const article = [...document.querySelectorAll('article[class*="assistantMessage"]')].at(-1);
  const status = article?.querySelector('[class*="processStatus"]');
  const boundary = article?.querySelector('[class*="processBoundary"]');
  const body = article?.querySelector('[class*="processCollapse"]');
  const chevron = boundary?.querySelector('svg');
  const text = article?.textContent ?? '';
  return {
    statusLabel: status?.textContent?.trim() ?? '',
    expanded: boundary?.getAttribute('aria-expanded') ?? null,
    boundaryDisabled: boundary?.disabled ?? null,
    bodyVisible: body ? body.getBoundingClientRect().height > 1 : false,
    bodyHeight: body ? Math.round(body.getBoundingClientRect().height) : 0,
    chevronTransform: chevron ? getComputedStyle(chevron).transform : '',
    text,
    shellCount: (text.match(/执行Shell/g) ?? []).length,
    answerVisible: (() => {
      const node = [...(article?.querySelectorAll('div') ?? [])]
        .find((item) => item.textContent?.includes('最终回答：F4.4 布局已经完成。'));
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
  await rm(join(outputDirectory, "f4-4-error.txt"), { force: true });

  ipcMain.handle(START_CHANNEL, (_event, input) => {
    acceptedRequestId = input.requestId;
    void push(processEvents(acceptedRequestId).slice(0, 4));
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
    setter.call(textarea, '帮我验证 F4.4 过程布局');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(requestAnimationFrame);
    textarea.form.requestSubmit();
    await new Promise(requestAnimationFrame);
  })()`);

  await waitFor(`document.querySelector('[class*="processBoundary"]')?.getAttribute('aria-expanded') === 'true'`);
  await waitFor(`document.querySelector('[class*="reasoningText"]')?.textContent?.includes('先检查现有结构')`);
  const reasoning = await window.webContents.executeJavaScript(`(() => {
    const text = document.querySelector('[class*="reasoningText"]');
    const label = document.querySelector('[class*="reasoningLabel"]');
    return { visible: text.getBoundingClientRect().height > 0, text: text.textContent,
      shimmer: getComputedStyle(label).animationName, card: text.closest('details') !== null };
  })()`);
  assert.equal(reasoning.visible, true);
  assert.equal(reasoning.card, false);
  assert.notEqual(reasoning.shimmer, "none");
  await push([{ ...processEvents(acceptedRequestId)[3], delta: "继续读取增量。" }]);
  await waitFor(`document.querySelector('[class*="reasoningText"]')?.textContent?.includes('继续读取增量。')`);
  await push(processEvents(acceptedRequestId).slice(4));
  await waitFor(`document.querySelector('article[class*="assistantMessage"]')?.textContent?.includes('ok')`);
  const streaming = await window.webContents.executeJavaScript(snapshot);
  assert.match(streaming.statusLabel, /^处理中 \d+(?:m(?: \d+s)?|s)$/);
  assert.equal(streaming.bodyVisible, true);
  assert.equal(streaming.boundaryDisabled, true);
  assert.equal(streaming.shellCount, 2);
  assert.ok(streaming.text.includes("先检查现有结构。"));
  assert.ok(streaming.text.includes("折叠边界应该放到最终回答之前。"));
  assert.equal(streaming.overflow, false);

  await waitFor(`document.querySelector('[class*="processLabel"]').textContent !== ${JSON.stringify(streaming.statusLabel)}`);
  const streamingLater = await window.webContents.executeJavaScript(snapshot);
  assert.notEqual(streamingLater.statusLabel, streaming.statusLabel, "生成中计时应持续更新");
  await window.webContents.executeJavaScript(`document.querySelector('[class*="processBoundary"]').click()`);
  await delay(100);
  const streamingAfterClick = await window.webContents.executeJavaScript(snapshot);
  assert.equal(streamingAfterClick.bodyVisible, true, "生成中不允许折叠");
  await writeFile(join(outputDirectory, "f4-4-streaming.png"), (await window.webContents.capturePage()).toPNG());

  await push(answerEvents(acceptedRequestId));
  await waitFor(`document.querySelector('[class*="processBoundary"]')?.getAttribute('aria-expanded') === 'false'`);
  await delay(400);
  const folded = await window.webContents.executeJavaScript(snapshot);
  assert.match(folded.statusLabel, /^已处理 \d+(?:m(?: \d+s)?|s)$/);
  assert.equal(folded.bodyVisible, false);
  assert.equal(folded.boundaryDisabled, false);
  assert.equal(folded.chevronTransform, "none");
  assert.equal(folded.answerVisible, true);
  assert.equal(folded.overflow, false);
  await writeFile(join(outputDirectory, "f4-4-folded.png"), (await window.webContents.capturePage()).toPNG());

  await delay(1_100);
  const foldedLater = await window.webContents.executeJavaScript(snapshot);
  assert.equal(foldedLater.statusLabel, folded.statusLabel, "终态计时必须冻结");

  await window.webContents.executeJavaScript(`document.querySelector('[class*="processBoundary"]').click()`);
  await delay(60);
  const transitioning = await window.webContents.executeJavaScript(snapshot);
  await delay(400);
  const expanded = await window.webContents.executeJavaScript(snapshot);
  assert.equal(expanded.bodyVisible, true);
  assert.ok(transitioning.bodyHeight > 0 && transitioning.bodyHeight < expanded.bodyHeight, "展开必须经历中间高度");
  const geometry = await window.webContents.executeJavaScript(`(() => {
    const status = document.querySelector('[class*="processStatus"]');
    const button = status.querySelector('button');
    const label = status.querySelector('[class*="processLabel"]');
    const divider = document.querySelector('[class*="processStartBoundary"]');
    return { right: button.getBoundingClientRect().left >= label.getBoundingClientRect().right,
      gap: divider.getBoundingClientRect().top - status.getBoundingClientRect().bottom,
      lines: document.querySelectorAll('[class*="processStartBoundary"]').length };
  })()`);
  assert.equal(geometry.right, true);
  assert.ok(geometry.gap <= 3);
  assert.equal(geometry.lines, 1);
  window.focus();
  window.webContents.focus();
  await window.webContents.executeJavaScript(`document.querySelector('[class*="resultToggle"]').focus()`);
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Space" });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Space" });
  await waitFor(`document.querySelector('[class*="resultToggle"]').getAttribute('aria-expanded') === 'true'`);
  await delay(350);
  assert.notEqual(expanded.chevronTransform, "none");
  assert.ok(expanded.bodyHeight > 0);
  assert.equal(expanded.answerVisible, true);
  await writeFile(join(outputDirectory, "f4-4-expanded.png"), (await window.webContents.capturePage()).toPNG());

  window.setSize(420, 760);
  await delay(400);
  const narrow = await window.webContents.executeJavaScript(snapshot);
  assert.equal(narrow.overflow, false);
  await writeFile(join(outputDirectory, "f4-4-narrow.png"), (await window.webContents.capturePage()).toPNG());
  const result = { reasoning, transitioning, geometry, narrow, streaming, streamingLater, streamingAfterClick, folded, foldedLater, expanded };
  await writeFile(join(outputDirectory, "f4-4-results.json"), JSON.stringify(result, null, 2));
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
  await writeFile(join(outputDirectory, "f4-4-error.txt"), String(error?.stack ?? error));
  app.exit(1);
});

async function waitFor(expression) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await delay(30);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}
