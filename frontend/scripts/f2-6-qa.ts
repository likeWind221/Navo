import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { app, BrowserWindow } from "electron";

import { KernelHostProcess } from "../electron/host/kernel-host-process.js";
import { resolveHostLaunchConfig } from "../electron/host/launch-config.js";
import { AgentTurnController } from "../electron/ipc/agent-turn-controller.js";
import { registerAgentTurnIpc } from "../electron/ipc/agent-turn-ipc.js";

const outputDirectory = resolve("qa-output");
const mockText = "这是用于验证真实流式链路的回答。它会分成多个增量，保持顺序并持续更新消息。".repeat(60);
app.setPath("userData", join(tmpdir(), `skillworld-f2-6-qa-${process.pid}`));

async function main(): Promise<void> {
  const useRealHost = process.env.SKILLWORLD_QA_REAL === "true";
  const scenario = process.env.SKILLWORLD_QA_SCENARIO;
  process.env.SKILLWORLD_HOST_MODE = useRealHost ? "real" : "mock";
  process.env.SKILLWORLD_REPO_ROOT = resolve("..");
  if (!useRealHost) {
    process.env.SKILLWORLD_MOCK_TEXT = mockText;
    process.env.SKILLWORLD_MOCK_CHUNK_CHARS = "40";
    process.env.SKILLWORLD_MOCK_DELAY_MS = "20";
    if (scenario !== undefined) process.env.SKILLWORLD_MOCK_MODE = scenario === "timeout" ? "hang" : scenario;
  }
  await app.whenReady();
  await mkdir(outputDirectory, { recursive: true });
  await rm(join(outputDirectory, "f2-6-error.txt"), { force: true });

  const launch = resolveHostLaunchConfig({ appPath: app.getAppPath() });
  const host = new KernelHostProcess(scenario === "startup-failure"
    ? { ...launch, command: resolve("missing-kernel-host-command"), startTimeoutMs: 50 }
    : launch);
  const turns = new AgentTurnController(host, scenario === "timeout" ? 50 : 120_000);
  const unregister = registerAgentTurnIpc(turns);
  const window = new BrowserWindow({
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
  const ownerId = window.webContents.id;
  window.webContents.once("destroyed", () => turns.cancelOwner(ownerId));

  try {
    if (scenario !== "startup-failure") await host.start();
    await window.loadFile(resolve("out/renderer/index.html"));
    window.show();
    window.focus();
    await assertCompositionSafety(window);
    if (scenario !== undefined) {
      await submit(window, `验证 ${scenario}`);
      await waitUntilIdle(window);
      const result = await snapshot(window);
      assert.ok(result.lastAssistantLength >= 0);
      assert.ok(result.lastAssistantStatus.includes(expectedScenarioText(scenario)));
      await writeFile(join(outputDirectory, `f2-7-${scenario}.json`), JSON.stringify(result, null, 2));
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
      return;
    }
    if (useRealHost) {
      await submit(window, "请只回复：真实链路连接成功");
      await waitUntilIdle(window, 120_000);
      const real = await snapshot(window);
      assert.ok(real.lastAssistantLength > 0);
      assert.equal(real.lastAssistantStatus, "");
      await writeFile(join(outputDirectory, "f2-6-real-results.json"), JSON.stringify(real, null, 2));
      process.stdout.write(`${JSON.stringify(real, null, 2)}\n`);
      return;
    }
    await submit(window, "请验证流式回答");
    await delay(140);
    const streaming = await snapshot(window);
    assert.equal(streaming.buttonLabel, "停止生成");
    assert.equal(streaming.assistantCount, 1);
    assert.ok(streaming.lastAssistantLength > 0 && streaming.lastAssistantLength < mockText.length);
    assert.equal(streaming.hasCursor, true);

    await waitUntilIdle(window);
    const completed = await snapshot(window);
    assert.equal(completed.lastAssistantLength, mockText.length);
    assert.equal(completed.lastAssistantStatus, "");
    assert.ok(completed.distanceFromBottom <= 1);

    await submit(window, "请测试停止");
    await delay(100);
    await window.webContents.executeJavaScript(
      `document.querySelector('button[aria-label="停止生成"]')?.click()`,
    );
    await waitUntilIdle(window);
    const cancelled = await snapshot(window);
    assert.equal(cancelled.lastAssistantStatus, "已停止生成");
    assert.ok(cancelled.lastAssistantLength < mockText.length);

    await window.webContents.executeJavaScript(`(() => {
      const history = document.querySelector('[class*="history"]');
      history.scrollTop = 0;
      history.dispatchEvent(new Event('scroll'));
    })()`);
    await delay(30);
    await submit(window, "滚动位置不要跟随");
    await waitUntilIdle(window);
    const preserved = await snapshot(window);
    assert.equal(preserved.scrollTop, 0);
    assert.equal(preserved.horizontalOverflow, false);

    await writeFile(join(outputDirectory, "f2-6-desktop.png"), (await window.webContents.capturePage()).toPNG());
    window.setSize(560, 720);
    await delay(80);
    const narrow = await snapshot(window);
    assert.equal(narrow.horizontalOverflow, false);
    await writeFile(join(outputDirectory, "f2-6-narrow.png"), (await window.webContents.capturePage()).toPNG());
    const result = { streaming, completed, cancelled, preserved, narrow };
    await writeFile(join(outputDirectory, "f2-6-results.json"), JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    unregister();
    turns.dispose();
    window.destroy();
    await host.close();
  }
}

async function submit(window: BrowserWindow, text: string): Promise<void> {
  await window.webContents.executeJavaScript(`(async () => {
    const textarea = document.querySelector('#chat-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, ${JSON.stringify(text)});
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(requestAnimationFrame);
    textarea.form.requestSubmit();
    await new Promise(requestAnimationFrame);
  })()`);
}

async function assertCompositionSafety(window: BrowserWindow): Promise<void> {
  const result = await window.webContents.executeJavaScript(`(async () => {
    const textarea = document.querySelector('#chat-input');
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setter.call(textarea, '中文输入法组合态');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(requestAnimationFrame);
    const event = new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true });
    Object.defineProperty(event, 'isComposing', { value: true });
    textarea.dispatchEvent(event);
    await new Promise(requestAnimationFrame);
    const state = {
      draft: textarea.value,
      messageCount: document.querySelectorAll('article').length,
    };
    setter.call(textarea, '');
    textarea.dispatchEvent(new Event('input', { bubbles: true }));
    return state;
  })()`);
  assert.equal(result.draft, "中文输入法组合态");
  assert.equal(result.messageCount, 0);
}

async function snapshot(window: BrowserWindow) {
  return window.webContents.executeJavaScript(`(() => {
    const history = document.querySelector('[class*="history"]');
    const assistants = [...document.querySelectorAll('article[aria-label="Agent 回复"]')];
    const last = assistants.at(-1);
    return {
      assistantCount: assistants.length,
      lastAssistantLength: last?.querySelector('p')?.textContent?.length ?? 0,
      lastAssistantStatus: last?.querySelector('[role="status"], [role="alert"]')?.textContent?.trim() ?? '',
      buttonLabel: document.querySelector('form button')?.getAttribute('aria-label'),
      hasCursor: Boolean(last?.querySelector('[class*="streamCursor"]')),
      scrollTop: history.scrollTop,
      distanceFromBottom: history.scrollHeight - history.clientHeight - history.scrollTop,
      horizontalOverflow: history.scrollWidth > history.clientWidth,
    };
  })()`);
}

async function waitUntilIdle(window: BrowserWindow, timeoutMs = 10_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const label = await window.webContents.executeJavaScript(
      `document.querySelector('form button')?.getAttribute('aria-label')`,
    );
    if (label === "发送消息") return;
    await delay(30);
  }
  throw new Error("F2.6 QA timed out waiting for Agent completion");
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs));
}

function expectedScenarioText(scenario: string): string {
  if (scenario === "failed") return "Mock Agent failed";
  if (scenario === "truncated") return "回答已达到长度上限";
  if (scenario === "crash") return "Agent 连接意外中断";
  if (scenario === "timeout") return "Agent 响应超时，请重试";
  if (scenario === "startup-failure") return "Agent 服务暂不可用，请稍后重试";
  throw new Error(`Unsupported F2.7 scenario: ${scenario}`);
}

void main().then(
  () => app.exit(0),
  async (error: unknown) => {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(join(outputDirectory, "f2-6-error.txt"), String(error instanceof Error ? error.stack : error));
    process.stderr.write(`${String(error)}\n`);
    app.exit(1);
  },
);
