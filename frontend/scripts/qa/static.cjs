const { mkdir, rm, writeFile } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
const assert = require("node:assert/strict");
const { app, BrowserWindow } = require("electron");

const url = process.argv[2] ?? "http://127.0.0.1:4173";
const outputDirectory = join(process.cwd(), "qa-output");
app.setPath("userData", join(tmpdir(), `skillworld-f1-2-3-qa-${process.pid}`));

function helpers() {
  const pause = () => new Promise((resolve) => setTimeout(resolve, 0));
  const setDraft = async (text) => {
    const textarea = document.querySelector("#chat-input");
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set;
    setter.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    await pause();
    return textarea;
  };
  return { pause, setDraft };
}

(async () => {
  await app.whenReady();
  await mkdir(outputDirectory, { recursive: true });
  await rm(join(outputDirectory, "error.txt"), { force: true });
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  await window.loadURL(url);
  window.show();
  window.focus();
  await new Promise((resolve) => setTimeout(resolve, 100));

  const behavior = await window.webContents.executeJavaScript(`(async () => {
    const { pause, setDraft } = (${helpers.toString()})();
    const textarea = document.querySelector('#chat-input');
    const button = document.querySelector('button[type="submit"]');
    const initial = { buttonDisabled: button.disabled, messageCount: document.querySelectorAll('article').length };

    await setDraft('   ');
    const blank = { buttonDisabled: button.disabled };

    await setDraft('中文输入法组合态');
    const composingEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(composingEnter, 'isComposing', { value: true });
    textarea.dispatchEvent(composingEnter);
    await pause();
    const composing = { messageCount: document.querySelectorAll('article').length, draft: textarea.value };

    const normalEnter = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    textarea.dispatchEvent(normalEnter);
    await pause();
    const submitted = { messageCount: document.querySelectorAll('article').length, draft: textarea.value };

    await setDraft('保留换行');
    const shiftEnter = new KeyboardEvent('keydown', { key: 'Enter', shiftKey: true, bubbles: true, cancelable: true });
    textarea.dispatchEvent(shiftEnter);
    await pause();
    const shifted = { messageCount: document.querySelectorAll('article').length, draft: textarea.value };

    await setDraft('焦点检查');
    textarea.form.requestSubmit();
    await pause();
    const focusedTextarea = document.querySelector('#chat-input');
    focusedTextarea.focus();
    const bubble = document.querySelector('article');
    const paragraph = bubble.querySelector('p');
    const bubbleStyle = getComputedStyle(bubble);
    const paragraphStyle = getComputedStyle(paragraph);
    const focusStyle = getComputedStyle(focusedTextarea);
    return {
      initial, blank, composing, submitted, shifted,
      spacing: {
        paddingTop: bubbleStyle.paddingTop,
        paddingBottom: bubbleStyle.paddingBottom,
        paragraphMarginTop: paragraphStyle.marginTop,
        paragraphMarginBottom: paragraphStyle.marginBottom,
      },
      focus: {
        activeElement: document.activeElement?.id,
        outlineStyle: focusStyle.outlineStyle,
        outlineWidth: focusStyle.outlineWidth,
        boxShadow: focusStyle.boxShadow,
      },
    };
  })()`);

  const nativeKeyboardBefore = await window.webContents.executeJavaScript(`(async () => {
    const { setDraft } = (${helpers.toString()})();
    const textarea = await setDraft('第一行');
    textarea.focus();
    return { messageCount: document.querySelectorAll('article').length };
  })()`);
  window.webContents.sendInputEvent({ type: "keyDown", keyCode: "Enter", modifiers: ["shift"] });
  window.webContents.sendInputEvent({ type: "char", keyCode: "\r", modifiers: ["shift"] });
  window.webContents.sendInputEvent({ type: "keyUp", keyCode: "Enter", modifiers: ["shift"] });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const nativeKeyboard = await window.webContents.executeJavaScript(`(() => ({
    draft: document.querySelector('#chat-input').value,
    messageCount: document.querySelectorAll('article').length,
  }))()`);

  const overflow = await window.webContents.executeJavaScript(`(async () => {
    const { pause, setDraft } = (${helpers.toString()})();
    for (let index = 0; index < 30; index += 1) {
      await setDraft('第 ' + (index + 1) + ' 条验收消息：用于检查连续气泡、滚动区域与长列表表现。');
      document.querySelector('#chat-input').form.requestSubmit();
      await pause();
    }
    await setDraft('长消息：' + '这是一段用于检查自动换行和横向溢出的内容。'.repeat(80));
    document.querySelector('#chat-input').form.requestSubmit();
    await pause();
    const history = document.querySelector('[class*="history"]');
    const bubbles = [...document.querySelectorAll('article')];
    const lastBubble = bubbles.at(-1);
    const followedScrollTop = history.scrollTop;
    const followedDistanceFromBottom = history.scrollHeight - history.clientHeight - history.scrollTop;
    history.scrollTop = 0;
    history.dispatchEvent(new Event('scroll'));
    await pause();
    await setDraft('滚离底部后不要强制跟随');
    document.querySelector('#chat-input').form.requestSubmit();
    await pause();
    const preservedScrollTop = history.scrollTop;
    history.scrollTop = history.scrollHeight;
    history.dispatchEvent(new Event('scroll'));
    return {
      messageCount: bubbles.length,
      historyClientHeight: history.clientHeight,
      historyScrollHeight: history.scrollHeight,
      followedScrollTop,
      followedDistanceFromBottom,
      preservedScrollTop,
      horizontalOverflow: history.scrollWidth > history.clientWidth,
      lastBubbleWidth: lastBubble.getBoundingClientRect().width,
      historyWidth: history.getBoundingClientRect().width,
    };
  })()`);

  await new Promise((resolve) => setTimeout(resolve, 100));
  await writeFile(join(outputDirectory, "desktop.png"), (await window.webContents.capturePage()).toPNG());
  window.setSize(560, 720);
  await new Promise((resolve) => setTimeout(resolve, 100));
  const narrow = await window.webContents.executeJavaScript(`(() => {
    const inputArea = document.querySelector('[class*="inputArea"]');
    const messageColumn = document.querySelector('[class*="messageColumn"]');
    const history = document.querySelector('[class*="history"]');
    return {
      viewportWidth: innerWidth,
      inputPadding: getComputedStyle(inputArea).padding,
      messageColumnPadding: getComputedStyle(messageColumn).padding,
      horizontalOverflow: history.scrollWidth > history.clientWidth,
    };
  })()`);
  await writeFile(join(outputDirectory, "narrow.png"), (await window.webContents.capturePage()).toPNG());

  const result = { behavior, nativeKeyboard, overflow, narrow };
  assert.equal(behavior.initial.buttonDisabled, true);
  assert.equal(behavior.blank.buttonDisabled, true);
  assert.equal(behavior.composing.messageCount, 0);
  assert.equal(behavior.composing.draft, "中文输入法组合态");
  assert.equal(behavior.submitted.messageCount, 1);
  assert.equal(behavior.submitted.draft, "");
  assert.equal(behavior.shifted.messageCount, 1);
  assert.equal(behavior.shifted.draft, "保留换行");
  assert.equal(nativeKeyboard.messageCount, nativeKeyboardBefore.messageCount);
  assert.ok(nativeKeyboard.draft.includes("\n"));
  assert.equal(behavior.spacing.paddingTop, behavior.spacing.paddingBottom);
  assert.equal(behavior.spacing.paragraphMarginTop, "0px");
  assert.equal(behavior.spacing.paragraphMarginBottom, "0px");
  assert.notEqual(behavior.focus.boxShadow, "none");
  assert.ok(overflow.historyScrollHeight > overflow.historyClientHeight);
  assert.ok(overflow.followedScrollTop > 0);
  assert.ok(overflow.followedDistanceFromBottom <= 1);
  assert.equal(overflow.preservedScrollTop, 0);
  assert.equal(overflow.horizontalOverflow, false);
  assert.equal(narrow.horizontalOverflow, false);
  await writeFile(join(outputDirectory, "results.json"), JSON.stringify(result, null, 2));
  console.log(JSON.stringify(result, null, 2));
  window.destroy();
  app.quit();
})().catch(async (error) => {
  await mkdir(outputDirectory, { recursive: true });
  await writeFile(join(outputDirectory, "error.txt"), String(error?.stack ?? error));
  process.exitCode = 1;
  app.quit();
});
