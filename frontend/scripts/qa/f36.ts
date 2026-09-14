import assert from "node:assert/strict";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { app, BrowserWindow } from "electron";

import { resolveHostLaunchConfig } from "../../electron/host/launch.js";
import { KernelHostProcess } from "../../electron/host/process.js";
import { AgentCommandController } from "../../electron/ipc/command/controller.js";
import { AgentTurnV2Controller } from "../../electron/ipc/agent/v2.js";
import { cancelAgentSessionOwner, registerAgentSessionIpc } from "../../electron/ipc/session.js";

const outputDirectory = resolve("qa-output");

process.env.NAVO_HOST_MODE = "mock";
process.env.NAVO_REPO_ROOT = resolve("..");
process.env.NAVO_MOCK_LLM_MODE = "hang";
app.setPath("userData", join(tmpdir(), `navo-f3-6-qa-${process.pid}`));

async function main(): Promise<void> {
  await app.whenReady();
  await mkdir(outputDirectory, { recursive: true });
  await rm(join(outputDirectory, "f3-6-error.txt"), { force: true });

  const host = new KernelHostProcess(resolveHostLaunchConfig({ appPath: app.getAppPath() }));
  const turns = new AgentTurnV2Controller(host);
  const commands = new AgentCommandController(host);
  const unregister = registerAgentSessionIpc(turns, commands);
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
  window.webContents.once("destroyed", () => cancelAgentSessionOwner(turns, commands, ownerId));

  try {
    await host.start();
    await window.loadFile(resolve("out/renderer/index.html"));
    window.show();
    window.focus();

    await submit(window, "/hello");
    const hello = await waitForCommand(window, "hello", "succeeded");
    assert.equal(hello.label, "/hello");

    await submit(window, "/unknown");
    const unknown = await waitForCommand(window, "unknown", "failed");

    await submit(window, "/hello now");
    const invalidArgs = await waitForCommand(window, "hello", "failed", 1);

    await submit(window, "keep this turn running");
    await waitForTurnBusy(window);
    await submit(window, "/hello");
    const concurrentCommand = await waitForCommand(window, "hello", "succeeded", 2);
    const concurrentTurn = await snapshot(window);
    assert.equal(concurrentTurn.assistantBusy, "true");

    await window.webContents.executeJavaScript(`document.querySelector('button[class*="stopButton"]')?.click()`);
    await waitForTurnIdle(window);
    const cancelledTurn = await snapshot(window);
    assert.equal(cancelledTurn.assistantBusy, "false");
    assert.equal(cancelledTurn.buttonLabel, "发送消息");
    assert.equal(cancelledTurn.commandCount, 4);
    const alignment = await alignmentSnapshot(window);
    const leftMessageInset = alignment.assistantLeft - alignment.composerLeft;
    const rightMessageInset = alignment.composerRight - alignment.assistantRight;
    assert.ok(leftMessageInset > 0);
    assert.ok(Math.abs(leftMessageInset - rightMessageInset) <= 1);
    assert.ok(Math.abs(alignment.userRight - alignment.assistantRight) <= 1);
    assert.ok(Math.abs(alignment.historyBottom - alignment.chatBottom) <= 1);
    assert.equal(alignment.inputPaddingTop, "0px");
    assert.notEqual(alignment.inputBackground, "rgba(0, 0, 0, 0)");
    assert.ok(alignment.lastMessageBottom <= alignment.composerTop);

    const result = { hello, unknown, invalidArgs, concurrentCommand, concurrentTurn, cancelledTurn, alignment };
    await writeFile(join(outputDirectory, "f3-6-mock-results.json"), JSON.stringify(result, null, 2));
    await writeFile(join(outputDirectory, "f3-6-mock.png"), (await window.webContents.capturePage()).toPNG());
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    unregister();
    turns.dispose();
    commands.dispose();
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

async function waitForCommand(
  window: BrowserWindow,
  name: string,
  status: "succeeded" | "failed",
  occurrence = 0,
): Promise<CommandSnapshot> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    const commands = await window.webContents.executeJavaScript(`(() => [...document.querySelectorAll('[class*="commandMessage"]')]
      .filter((item) => item.querySelector('[class*="activityLabel"]')?.textContent?.trim() === ${JSON.stringify(`/${name}`)})
      .map((item) => ({
        label: item.querySelector('[class*="activityLabel"]')?.textContent?.trim() ?? '',
        status: item.querySelector('[class*="activityRow"]')?.getAttribute('data-status'),
        summary: item.querySelector('[class*="commandSummary"]')?.textContent?.trim() ?? '',
        failure: item.querySelector('[class*="commandFailure"]')?.textContent?.trim() ?? '',
      })) )()`);
    const command = commands[occurrence] as CommandSnapshot | undefined;
    if (command?.status === status) return command;
    await delay(30);
  }
  throw new Error(`Timed out waiting for /${name} ${status}`);
}

async function waitForTurnBusy(window: BrowserWindow): Promise<void> {
  await waitFor(window, `document.querySelector('article[aria-label*="Agent"][aria-busy="true"]') !== null`);
}

async function waitForTurnIdle(window: BrowserWindow): Promise<void> {
  await waitFor(window, `document.querySelector('article[aria-label*="Agent"][aria-busy="true"]') === null
    && document.querySelector('button[class*="stopButton"]') === null`);
}

async function waitFor(window: BrowserWindow, expression: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await delay(30);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

async function snapshot(window: BrowserWindow): Promise<Snapshot> {
  return window.webContents.executeJavaScript(`(() => ({
    commandCount: document.querySelectorAll('[class*="commandMessage"]').length,
    assistantBusy: document.querySelectorAll('article[aria-label*="Agent"]').item(
      document.querySelectorAll('article[aria-label*="Agent"]').length - 1,
    )?.getAttribute('aria-busy') ?? 'false',
    buttonLabel: document.querySelector('form button')?.getAttribute('aria-label') ?? '',
  }))()`);
}

async function alignmentSnapshot(window: BrowserWindow): Promise<AlignmentSnapshot> {
  return window.webContents.executeJavaScript(`(() => ({
    assistantLeft: document.querySelector('article[aria-label="Agent 回复"]')?.getBoundingClientRect().left ?? -1,
    assistantRight: document.querySelector('article[aria-label="Agent 回复"]')?.getBoundingClientRect().right ?? -1,
    userRight: document.querySelector('article[aria-label="你的消息"]')?.getBoundingClientRect().right ?? -1,
    composerLeft: document.querySelector('form[class*="composer"]')?.getBoundingClientRect().left ?? -1,
    composerRight: document.querySelector('form[class*="composer"]')?.getBoundingClientRect().right ?? -1,
    composerTop: document.querySelector('form[class*="composer"]')?.getBoundingClientRect().top ?? -1,
    lastMessageBottom: [...document.querySelectorAll('article')].at(-1)?.getBoundingClientRect().bottom ?? -1,
    historyBottom: document.querySelector('[class*="history"]')?.getBoundingClientRect().bottom ?? -1,
    chatBottom: document.querySelector('[class*="chat"]')?.getBoundingClientRect().bottom ?? -1,
    inputPaddingTop: getComputedStyle(document.querySelector('[class*="inputArea"]')).paddingTop,
    inputBackground: getComputedStyle(document.querySelector('[class*="inputArea"]')).backgroundColor,
  }))()`);
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs));
}

interface CommandSnapshot {
  readonly label: string;
  readonly status: string | null;
  readonly summary: string;
  readonly failure: string;
}

interface Snapshot {
  readonly commandCount: number;
  readonly assistantBusy: string;
  readonly buttonLabel: string;
}

interface AlignmentSnapshot {
  readonly assistantLeft: number;
  readonly assistantRight: number;
  readonly userRight: number;
  readonly composerLeft: number;
  readonly composerRight: number;
  readonly composerTop: number;
  readonly lastMessageBottom: number;
  readonly historyBottom: number;
  readonly chatBottom: number;
  readonly inputPaddingTop: string;
  readonly inputBackground: string;
}

void main().then(
  () => app.exit(0),
  async (error: unknown) => {
    await mkdir(outputDirectory, { recursive: true });
    await writeFile(join(outputDirectory, "f3-6-error.txt"), String(error instanceof Error ? error.stack : error));
    process.stderr.write(`${String(error)}\n`);
    app.exit(1);
  },
);
