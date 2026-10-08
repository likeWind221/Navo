import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { app, BrowserWindow } from "electron";

import { resolveHostLaunchConfig } from "../../electron/host/launch.js";
import { KernelHostProcess } from "../../electron/host/process.js";
import { AgentCommandController } from "../../electron/ipc/command/controller.js";
import { AgentTurnV2Controller } from "../../electron/ipc/agent/v2.js";
import { cancelAgentSessionOwner, registerAgentSessionIpc } from "../../electron/ipc/session.js";
import { registerProjectIpc } from "../../electron/ipc/project.js";

const outputDirectory = resolve("qa-output");
const mode = process.env.NAVO_HOST_MODE ?? "mock";

process.env.NAVO_HOST_MODE = mode;
process.env.NAVO_REPO_ROOT ??= resolve("..");
app.setPath("userData", join(tmpdir(), `navo-f5-2-qa-${process.pid}`));

async function main(): Promise<void> {
  await app.whenReady();
  await mkdir(outputDirectory, { recursive: true });
  const workspaceRoot = await mkdtemp(join(tmpdir(), "navo-f5-2-workspace-"));
  let nextChoice: string | null = workspaceRoot;

  const host = new KernelHostProcess(resolveHostLaunchConfig({ appPath: app.getAppPath() }));
  const turns = new AgentTurnV2Controller(host);
  const commands = new AgentCommandController(host);
  const unregisterSession = registerAgentSessionIpc(turns, commands);
  const unregisterProject = registerProjectIpc(host, async () => nextChoice === null
    ? { canceled: true, filePaths: [] }
    : { canceled: false, filePaths: [nextChoice] });
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

    await click(window, `[aria-label="侧栏视图"] button[aria-pressed]`, "项目");
    await waitFor(window, `document.querySelector('nav[aria-label="项目列表"]')?.textContent.includes('Host 重启后会清空')`);
    const emptyNotice = await text(window, `nav[aria-label="项目列表"]`);

    const name = `QA 项目 ${Date.now()}`;
    const goal = "验证创建、列表与打开链路";
    await click(window, `button[class*="create"]`);
    await waitFor(window, `document.querySelector('dialog[open]') !== null`);

    await click(window, `dialog button[type="submit"]`);
    await waitFor(window, `document.querySelector('dialog [role="alert"]')?.textContent.includes('请填写项目名称')`);

    await fill(window, `dialog input[name="name"]`, name);
    await fill(window, `dialog textarea[name="goal"]`, goal);
    nextChoice = null;
    await click(window, `dialog button`, "选择目录");
    await delay(200);
    assert.equal(await text(window, `dialog code`), "尚未选择");
    nextChoice = workspaceRoot;
    await click(window, `dialog button`, "选择目录");
    await waitFor(window, `document.querySelector('dialog code')?.textContent === ${JSON.stringify(workspaceRoot)}`);
    await click(window, `dialog button[type="submit"]`);

    const panel = `section[data-active="true"] article[aria-label=${JSON.stringify(`项目 ${name}`)}]`;
    await waitFor(window, `document.querySelector(${JSON.stringify(panel)}) !== null`);
    const detail = await text(window, panel);
    assert.ok(detail.includes(goal));
    assert.ok(detail.includes(workspaceRoot));
    assert.ok(detail.includes("进行中"));
    assert.equal(await count(window, `dialog[open]`), 0);
    const listed = await text(window, `nav[aria-label="项目列表"]`);
    assert.ok(listed.includes(name));
    const tabs = await text(window, `nav[aria-label="已打开的标签页"]`);
    assert.ok(tabs.includes(name));
    await writeFile(join(outputDirectory, `f5-2-${mode}-desktop.png`), (await window.webContents.capturePage()).toPNG());

    await click(window, `button[class*="create"]`);
    await waitFor(window, `document.querySelector('dialog[open]') !== null`);
    await fill(window, `dialog input[name="name"]`, `${name} 重复目录`);
    await fill(window, `dialog textarea[name="goal"]`, goal);
    await click(window, `dialog button`, "选择目录");
    await waitFor(window, `document.querySelector('dialog code')?.textContent === ${JSON.stringify(workspaceRoot)}`);
    await click(window, `dialog button[type="submit"]`);
    await waitFor(window, `document.querySelector('dialog [role="alert"]')?.textContent.includes('已被其他项目绑定')`);
    const conflict = await text(window, `dialog [role="alert"]`);
    await click(window, `dialog button`, "取消");
    await waitFor(window, `document.querySelector('dialog[open]') === null`);

    window.setContentSize(390, 760);
    await delay(400);
    await click(window, `nav[aria-label="已打开的标签页"] button[aria-label]`, `关闭 ${name}`);
    await click(window, `nav[aria-label="项目列表"] button`, name);
    await waitFor(window, `document.querySelector(${JSON.stringify(panel)}) !== null`);
    await waitFor(window, `document.querySelector('aside')?.getAttribute('data-open') === 'false'`);
    await delay(400);
    const overflow = await window.webContents.executeJavaScript(`(() => ({
      viewport: window.innerWidth,
      scrollWidth: document.documentElement.scrollWidth,
      panelScrollWidth: document.querySelector('section[data-active="true"] article')?.scrollWidth ?? 0,
      panelClientWidth: document.querySelector('section[data-active="true"] article')?.clientWidth ?? 0,
    }))()`) as { viewport: number; scrollWidth: number; panelScrollWidth: number; panelClientWidth: number };
    assert.ok(overflow.scrollWidth <= overflow.viewport);
    assert.ok(overflow.panelScrollWidth <= overflow.panelClientWidth);
    await writeFile(join(outputDirectory, `f5-2-${mode}-narrow.png`), (await window.webContents.capturePage()).toPNG());

    const secondRoot = join(workspaceRoot, "second");
    await mkdir(secondRoot);
    nextChoice = secondRoot;
    const secondName = `${name} 第二个项目`;
    await click(window, `button[aria-controls]`, "展开侧栏");
    await click(window, `button[class*="create"]`);
    await waitFor(window, `document.querySelector('dialog[open]') !== null`);
    await fill(window, `dialog input[name="name"]`, secondName);
    await fill(window, `dialog textarea[name="goal"]`, goal);
    await click(window, `dialog button`, "选择目录");
    await waitFor(window, `document.querySelector('dialog code')?.textContent === ${JSON.stringify(secondRoot)}`);
    await click(window, `dialog button[type="submit"]`);
    const secondPanel = `section[data-active="true"] article[aria-label=${JSON.stringify(`项目 ${secondName}`)}]`;
    await waitFor(window, `document.querySelector(${JSON.stringify(secondPanel)}) !== null`);
    await waitFor(window, `document.querySelector('aside')?.getAttribute('data-open') === 'false'`);
    await click(window, `nav[aria-label="已打开的标签页"] button[aria-controls]`, "当前会话");
    await delay(300);
    await click(window, `nav[aria-label="已打开的标签页"] button[aria-controls]`, secondName);
    await delay(400);
    const tabStrip = await window.webContents.executeJavaScript(`(() => {
      const nav = document.querySelector('nav[aria-label="已打开的标签页"]');
      const last = [...nav.querySelectorAll('[data-active]')].at(-1);
      const navBox = nav.getBoundingClientRect();
      const lastBox = last.getBoundingClientRect();
      return {
        tabCount: nav.querySelectorAll('[data-active]').length,
        offsetHeight: nav.offsetHeight,
        clientHeight: nav.clientHeight,
        scrollbarWidth: getComputedStyle(nav).scrollbarWidth,
        scrollable: nav.scrollWidth > nav.clientWidth,
        lastActive: last.getAttribute('data-active'),
        lastVisible: lastBox.left >= navBox.left - 1 && lastBox.right <= navBox.right + 1,
        viewport: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      };
    })()`) as Record<string, unknown>;
    assert.ok((tabStrip.tabCount as number) >= 3);
    assert.equal(tabStrip.offsetHeight, tabStrip.clientHeight);
    assert.equal(tabStrip.scrollbarWidth, "none");
    assert.equal(tabStrip.lastActive, "true");
    assert.equal(tabStrip.lastVisible, true);
    assert.ok((tabStrip.scrollWidth as number) <= (tabStrip.viewport as number));
    const fadeAtEnd = await fadeState(window);
    assert.deepEqual([fadeAtEnd.start, fadeAtEnd.end], ["true", "false"]);
    assert.equal(fadeAtEnd.fadeStart, "28px");
    assert.ok(fadeAtEnd.activeLeft >= fadeAtEnd.navLeft + 28);
    await writeFile(join(outputDirectory, `f5-2-${mode}-tabs-narrow.png`), (await window.webContents.capturePage()).toPNG());

    await window.webContents.executeJavaScript(`document.querySelector('nav[aria-label="已打开的标签页"]').scrollLeft = 0`);
    await delay(200);
    const fadeAtStart = await fadeState(window);
    assert.deepEqual([fadeAtStart.start, fadeAtStart.end], ["false", "true"]);
    assert.equal(fadeAtStart.fadeEnd, "28px");
    await writeFile(join(outputDirectory, `f5-2-${mode}-tabs-narrow-start.png`), (await window.webContents.capturePage()).toPNG());

    window.setContentSize(1280, 800);
    await click(window, `nav[aria-label="已打开的标签页"] button[aria-label]`, `关闭 ${secondName}`);
    await click(window, `nav[aria-label="已打开的标签页"] button[aria-label]`, `关闭 ${name}`);
    await delay(400);
    const fadeDesktop = await fadeState(window);
    assert.equal(fadeDesktop.tabCount, 1);
    assert.deepEqual(
      [fadeDesktop.start, fadeDesktop.end, fadeDesktop.fadeStart, fadeDesktop.fadeEnd],
      ["false", "false", "0px", "0px"],
    );
    await writeFile(join(outputDirectory, `f5-2-${mode}-tabs-desktop.png`), (await window.webContents.capturePage()).toPNG());

    const result = { mode, emptyNotice, name, detail, conflict, overflow, tabStrip, fadeAtEnd, fadeAtStart, fadeDesktop };
    await writeFile(join(outputDirectory, `f5-2-${mode}-results.json`), JSON.stringify(result, null, 2));
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  } finally {
    unregisterProject();
    unregisterSession();
    turns.dispose();
    commands.dispose();
    window.destroy();
    await host.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}

async function fadeState(window: BrowserWindow): Promise<FadeState> {
  return window.webContents.executeJavaScript(`(() => {
    const nav = document.querySelector('nav[aria-label="已打开的标签页"]');
    const style = getComputedStyle(nav);
    return {
      tabCount: nav.querySelectorAll('[data-active]').length,
      start: nav.dataset.overflowStart ?? '',
      end: nav.dataset.overflowEnd ?? '',
      fadeStart: style.getPropertyValue('--fade-start').trim(),
      fadeEnd: style.getPropertyValue('--fade-end').trim(),
      navLeft: nav.getBoundingClientRect().left,
      activeLeft: nav.querySelector('[data-active="true"]').getBoundingClientRect().left,
    };
  })()`);
}

interface FadeState {
  readonly tabCount: number;
  readonly start: string;
  readonly end: string;
  readonly fadeStart: string;
  readonly fadeEnd: string;
  readonly navLeft: number;
  readonly activeLeft: number;
}

async function click(window: BrowserWindow, selector: string, label?: string): Promise<void> {
  const clicked = await window.webContents.executeJavaScript(`(() => {
    const target = [...document.querySelectorAll(${JSON.stringify(selector)})]
      .find(element => ${label === undefined ? "true" : `(element.getAttribute('aria-label') ?? element.textContent).trim() === ${JSON.stringify(label)}`});
    target?.click();
    return target !== undefined;
  })()`);
  assert.ok(clicked, `Missing ${selector} ${label ?? ""}`);
  await delay(50);
}

async function fill(window: BrowserWindow, selector: string, value: string): Promise<void> {
  await window.webContents.executeJavaScript(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, ${JSON.stringify(value)});
    element.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  await delay(30);
}

async function text(window: BrowserWindow, selector: string): Promise<string> {
  return window.webContents.executeJavaScript(`document.querySelector(${JSON.stringify(selector)})?.textContent ?? ''`);
}

async function count(window: BrowserWindow, selector: string): Promise<number> {
  return window.webContents.executeJavaScript(`document.querySelectorAll(${JSON.stringify(selector)}).length`);
}

async function waitFor(window: BrowserWindow, expression: string): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (await window.webContents.executeJavaScript(`Boolean(${expression})`)) return;
    await delay(30);
  }
  throw new Error(`Timed out waiting for ${expression}`);
}

function delay(durationMs: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, durationMs));
}

void main().then(
  () => app.exit(0),
  async (error: unknown) => {
    const message = error instanceof Error ? error.stack ?? error.message : String(error);
    process.stderr.write(`${message}\n`);
    await writeFile(join(outputDirectory, `f5-2-${mode}-error.txt`), message).catch(() => undefined);
    app.exit(1);
  },
);
