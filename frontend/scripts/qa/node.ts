import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { app, BrowserWindow } from "electron";
import type { ProjectDetailV1, ProjectListV1 } from "../../../rpc/project.js";
import { registerProjectIpc } from "../../electron/ipc/project.js";
import { ProjectController } from "../../electron/ipc/project/controller.js";
import { ControlledProjectHost } from "./controlled.js";

const timeoutMs = Number(process.env.NAVO_QA_TIMEOUT_MS ?? 180_000);
const deadline = Date.now() + timeoutMs;
const output = resolve(process.env.NAVO_QA_OUTPUT ?? join(tmpdir(), "navo-f56a-qa"));
process.env.NAVO_HOST_MODE = "controlled";
process.env.NAVO_REPO_ROOT ??= resolve("..");
app.setPath("userData", join(tmpdir(), "navo-f56a-electron-" + process.pid));
app.on("window-all-closed", () => undefined);

interface Evidence {
  readonly mode: "controlled";
  readonly output: string;
  readonly timeoutMs: number;
  status?: "passed" | "failed";
  error?: string;
  project?: unknown;
  nodes?: unknown;
  turns?: unknown;
  drafts?: unknown;
  execution?: unknown;
  locked?: unknown;
  layout?: unknown;
  modelCalls?: number;
  screenshots?: string[];
}

async function main(): Promise<void> {
  await app.whenReady();
  await mkdir(output, { recursive: true });
  const workspace = await mkdtemp(join(tmpdir(), "navo-f56a-workspace-"));
  const host = new ControlledProjectHost();
  const controller = new ProjectController(host);
  const unregister = registerProjectIpc(host, async () => ({ canceled: false, filePaths: [workspace] }), controller);
  const window = new BrowserWindow({
    width: 1280, height: 900, show: false,
    webPreferences: { preload: resolve("out/preload/index.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const evidence: Evidence = { mode: "controlled", output, timeoutMs };
  let timer: NodeJS.Timeout | undefined;
  try {
    const flow = runFlow(window, host, evidence);
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error("F5.6a QA exceeded " + timeoutMs + "ms")), timeoutMs);
    });
    await Promise.race([flow, timeout]);
    evidence.status = "passed";
    await writeEvidence(evidence);
  } catch (error: unknown) {
    evidence.status = "failed";
    evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
    if (!window.isDestroyed()) {
      const screenshot = join(output, "f5-6a-failure.png");
      await writeFile(screenshot, (await window.webContents.capturePage()).toPNG()).catch(() => undefined);
      evidence.screenshots = [screenshot];
    }
    await writeEvidence(evidence);
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    unregister();
    controller.dispose();
    if (!window.isDestroyed()) window.destroy();
    await rm(workspace, { recursive: true, force: true });
  }
}

async function runFlow(window: BrowserWindow, host: ControlledProjectHost, evidence: Evidence): Promise<void> {
  await window.loadFile(resolve("out/renderer/index.html"));
  window.show();
  await click(window, '[aria-label="侧栏视图"] button', "项目");
  await waitFor(window, "document.querySelector('nav[aria-label=\"项目列表\"]') !== null");

  const name = "F5.6a QA " + Date.now();
  const projectId = await createProject(window, name, "验证 Main 规划、节点执行、取消和隔离；不调用真实模型。");
  const panel = "article[aria-label=" + JSON.stringify("项目 " + name) + "]";
  await waitFor(window, "document.querySelector(" + JSON.stringify(panel) + ") !== null");
  await send(window, panel, "请复述目标，在我确认前不要规划。");
  await send(window, panel, "我确认目标。请创建恰好两个节点的执行路线，第一个可执行，第二个锁定。");
  const planned = await waitForRoadmap(window, projectId);
  assert.equal(planned.roadmap?.nodes.length, 2);
  assert.equal(planned.roadmap?.nodes[0]?.status, "idle");
  assert.equal(planned.roadmap?.nodes[0]?.actions.run, true);
  assert.equal(planned.roadmap?.nodes[1]?.status, "locked");
  assert.equal(planned.roadmap?.nodes[1]?.actions.run, false);
  evidence.project = planned.project;
  evidence.nodes = planned.roadmap?.nodes.map(item => ({
    nodeId: item.nodeId, status: item.status, run: item.actions.run, turnActive: item.turnActive, hasSession: item.hasSession,
  }));

  const nodeOneButton = 'button[data-node-id="controlled-node-1"]';
  const nodeTwoButton = 'button[data-node-id="controlled-node-2"]';
  const nodeOneInput = "#project-" + projectId + "-node-controlled-node-1-chat-input";
  const nodeTwoInput = "#project-" + projectId + "-node-controlled-node-2-chat-input";
  const mainInput = "#project-" + projectId + "-main-chat-input";
  await waitFor(window, "document.querySelector(" + JSON.stringify(nodeOneButton) + ")?.hidden === false");
  await clickAt(window, nodeOneButton);
  await waitFor(window, "document.querySelector(" + JSON.stringify(nodeOneInput) + ") !== null");
  assert.equal(await disabled(window, nodeOneInput), false);
  const nodeOneText = await text(window, '[aria-label="节点详情"]');
  assert.ok(nodeOneText.includes("确认目标并整理执行路线"));
  assert.ok(nodeOneText.includes("完成并可检查"));

  await fill(window, nodeOneInput, "保留节点草稿");
  await click(window, 'button[aria-label="切换到 Main"]');
  await waitFor(window, "document.querySelector(" + JSON.stringify(mainInput) + ") !== null");
  await fill(window, mainInput, "保留 Main 草稿");
  const turnsBeforeSwitch = host.turnInputs.length;
  await clickAt(window, nodeOneButton);
  await waitFor(window, "document.querySelector(" + JSON.stringify(nodeOneInput) + ") !== null");
  assert.equal(await value(window, nodeOneInput), "保留节点草稿");
  await click(window, 'button[aria-label="切换到 Main"]');
  await waitFor(window, "document.querySelector(" + JSON.stringify(mainInput) + ") !== null");
  assert.equal(await value(window, mainInput), "保留 Main 草稿");
  assert.equal(host.turnInputs.length, turnsBeforeSwitch);
  await clickAt(window, nodeOneButton);
  await waitFor(window, "document.querySelector(" + JSON.stringify(nodeOneInput) + ") !== null");
  evidence.drafts = { node: "保留节点草稿", main: "保留 Main 草稿", implicitTurns: host.turnInputs.length - turnsBeforeSwitch };

  await fill(window, nodeOneInput, "停止前：保持在途");
  const turnsBeforeCancellation = host.turnInputs.length;
  await clickAt(window, panel + ' button[aria-label="发送消息"]');
  await waitFor(window, "document.querySelector(" + JSON.stringify(panel) + ")?.querySelector('button[aria-label=\"停止生成\"]') !== null");
  await waitFor(window, "document.querySelector(" + JSON.stringify(nodeOneButton) + ")?.getAttribute('data-status') === '执行中'");
  assert.equal(host.turnInputs.length, turnsBeforeCancellation + 1);
  assert.deepEqual(host.turnInputs.at(-1)?.target, { kind: "node", nodeId: "controlled-node-1" });
  await click(window, 'button[aria-label="切换到 Main"]');
  await waitFor(window, "document.querySelector(" + JSON.stringify(mainInput) + ") !== null");
  await delay(250);
  assert.equal(host.abortedTargets.length, 0);
  const duringSwitch = await projectState(window, projectId);
  assert.equal(duringSwitch.type, "ok");
  if (duringSwitch.type === "ok") {
    assert.equal(duringSwitch.value.roadmap?.nodes.find(item => item.nodeId === "controlled-node-1")?.turnActive, true);
  }
  await clickAt(window, nodeOneButton);
  await waitFor(window, "document.querySelector(" + JSON.stringify(panel) + ")?.querySelector('button[aria-label=\"停止生成\"]') !== null");
  await clickAt(window, panel + ' button[aria-label="停止生成"]');
  await waitFor(window, "document.querySelector(" + JSON.stringify(nodeOneButton) + ")?.getAttribute('data-status') === '可执行'");
  assert.deepEqual(host.abortedTargets, [{ kind: "node", nodeId: "controlled-node-1" }]);
  assert.equal(host.turnInputs.length, turnsBeforeCancellation + 1);

  const beforeCompletedReplies = await countReplies(window, panel);
  await fill(window, nodeOneInput, "完成一次节点执行");
  await clickAt(window, panel + ' button[aria-label="发送消息"]');
  await waitFor(window, "document.querySelector(" + JSON.stringify(panel) + ")?.querySelector('button[aria-label=\"停止生成\"]') !== null");
  await waitFor(window, "document.querySelector(" + JSON.stringify(nodeOneButton) + ")?.getAttribute('data-status') === '执行中'");
  const reply = await waitForReply(window, panel, beforeCompletedReplies, 10_000);
  assert.equal(reply.status, "completed");
  await waitFor(window, "document.querySelector(" + JSON.stringify(nodeOneButton) + ")?.getAttribute('data-status') === '可执行'");
  const executed = await projectState(window, projectId);
  assert.equal(executed.type, "ok");
  if (executed.type === "ok") {
    const node = executed.value.roadmap?.nodes.find(item => item.nodeId === "controlled-node-1");
    assert.equal(node?.turnActive, false);
    assert.equal(node?.hasSession, true);
    evidence.execution = { status: node?.status, turnActive: node?.turnActive, hasSession: node?.hasSession, reply: reply.text };
  }

  await clickAt(window, nodeTwoButton);
  await waitFor(window, "document.querySelector(" + JSON.stringify(nodeTwoInput) + ") !== null");
  assert.equal(await disabled(window, nodeTwoInput), true);
  assert.equal(await disabled(window, panel + ' button[aria-label="发送消息"]'), true);
  assert.ok((await text(window, panel)).includes("等待前置节点完成"));
  evidence.locked = {
    disabled: await disabled(window, nodeTwoInput),
    hint: "等待前置节点完成",
    mapStatus: await window.webContents.executeJavaScript("document.querySelector(" + JSON.stringify(nodeTwoButton) + ")?.getAttribute('data-status')"),
  };

  await clickAt(window, nodeOneButton);
  window.setContentSize(547, 760);
  await waitFor(window, "innerWidth <= 547");
  await settleRenderer(window);
  const layout = await window.webContents.executeJavaScript("({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, inputDisabled: document.querySelector(" + JSON.stringify(nodeOneInput) + ")?.disabled ?? null })");
  assert.ok(layout.scrollWidth <= layout.viewport);
  assert.equal(layout.inputDisabled, false);
  evidence.layout = layout;
  evidence.turns = host.turnInputs.map(input => ({ text: input.text, target: input.target }));
  evidence.modelCalls = 0;
  const wide = join(output, "f5-6a-node-wide.png");
  const narrow = join(output, "f5-6a-node-narrow.png");
  window.setContentSize(1280, 900);
  await settleRenderer(window);
  await writeFile(wide, (await window.webContents.capturePage()).toPNG());
  window.setContentSize(547, 760);
  await settleRenderer(window);
  await writeFile(narrow, (await window.webContents.capturePage()).toPNG());
  evidence.screenshots = [wide, narrow];
  await writeEvidence(evidence);
}

async function createProject(window: BrowserWindow, name: string, goal: string): Promise<string> {
  await click(window, 'button[class*="create"]');
  await waitFor(window, "document.querySelector('dialog[open]') !== null");
  await fill(window, 'dialog input[name="name"]', name);
  await fill(window, 'dialog textarea[name="goal"]', goal);
  await click(window, "dialog button", "选择目录");
  await waitFor(window, "document.querySelector('dialog code')?.textContent?.length > 0");
  await click(window, 'dialog button[type="submit"]');
  return waitForProject(window, name);
}

type BrowserResult<T> =
  | { readonly type: "ok"; readonly value: T }
  | { readonly type: "failed"; readonly failure: { readonly code: string; readonly message: string } };

async function projectState(window: BrowserWindow, projectId: string): Promise<BrowserResult<ProjectDetailV1>> {
  return window.webContents.executeJavaScript("window.desktop.project.get({ projectId: " + JSON.stringify(projectId) + " })");
}

async function waitForProject(window: BrowserWindow, name: string): Promise<string> {
  while (Date.now() < deadline) {
    const result: BrowserResult<ProjectListV1> = await window.webContents.executeJavaScript("window.desktop.project.list()");
    if (result.type === "ok") {
      const project = result.value.projects.find(item => item.name === name);
      if (project !== undefined) return project.projectId;
    }
    await delay(100);
  }
  throw new Error("Timed out waiting for project " + name);
}

async function waitForRoadmap(window: BrowserWindow, projectId: string): Promise<ProjectDetailV1> {
  while (Date.now() < deadline) {
    const result = await projectState(window, projectId);
    if (result.type === "ok" && result.value.roadmap?.nodes.length === 2) return result.value;
    await delay(100);
  }
  throw new Error("Timed out waiting for the controlled roadmap");
}

async function send(window: BrowserWindow, selector: string, textValue: string): Promise<void> {
  const input = selector + " textarea";
  const beforeReplies = await countReplies(window, selector);
  await fill(window, input, textValue);
  assert.equal(await value(window, input), textValue);
  await waitFor(window, "!document.querySelector(" + JSON.stringify(selector) + ")?.querySelector('button[aria-label=\"发送消息\"]')?.hasAttribute('disabled')");
  await clickAt(window, selector + ' button[aria-label="发送消息"]');
  await waitFor(window, "document.querySelector(" + JSON.stringify(input) + ")?.value === ''");
  const result = await waitForReply(window, selector, beforeReplies, 10_000);
  if (result.status !== "completed") throw new Error("Turn " + result.status + ": " + result.text);
}

async function countReplies(window: BrowserWindow, selector: string): Promise<number> {
  return window.webContents.executeJavaScript("document.querySelector(" + JSON.stringify(selector) + ")?.querySelectorAll('[aria-label=\"Agent 回复\"]').length ?? 0");
}

type ReplyResult = { readonly status: "completed" | "failed" | "truncated" | "cancelled"; readonly text: string };

async function waitForReply(window: BrowserWindow, selector: string, beforeReplies: number, maxWaitMs: number): Promise<ReplyResult> {
  const until = Math.min(deadline, Date.now() + maxWaitMs);
  while (Date.now() < until) {
    const result: ReplyResult | null = await window.webContents.executeJavaScript("(() => { const p=document.querySelector(" + JSON.stringify(selector) + "); const replies=[...p?.querySelectorAll('[aria-label=\"Agent 回复\"]') ?? []]; if (replies.length <= " + beforeReplies + ") return null; const last=replies.at(-1); if (last?.getAttribute('aria-busy') === 'true') return null; const text=last?.textContent ?? ''; if (last?.querySelector('[role=\"alert\"]') !== null) return { status: 'failed', text }; if (text.includes('回答已达到长度上限')) return { status: 'truncated', text }; if (text.includes('已停止生成')) return { status: 'cancelled', text }; return { status: 'completed', text }; })()");
    if (result !== null) return result;
    await delay(100);
  }
  throw new Error("Timed out waiting for the current Agent reply");
}

async function click(window: BrowserWindow, selector: string, label?: string): Promise<void> {
  const predicate = label === undefined ? "true" : "(x.getAttribute('aria-label')??x.textContent).trim()===" + JSON.stringify(label);
  const clicked = await window.webContents.executeJavaScript("(() => { const e=[...document.querySelectorAll(" + JSON.stringify(selector) + ")].find(x=>" + predicate + "); e?.click(); return e!==undefined; })()");
  assert.ok(clicked, "Missing " + selector + " " + (label ?? ""));
}

async function clickAt(window: BrowserWindow, selector: string): Promise<void> {
  const point: { readonly x: number; readonly y: number } | null = await window.webContents.executeJavaScript("(() => { const e=document.querySelector(" + JSON.stringify(selector) + "); if (!(e instanceof HTMLElement)) return null; const rect=e.getBoundingClientRect(); return { x:(rect.left+rect.right)/2, y:(rect.top+rect.bottom)/2 }; })()");
  assert.ok(point !== null, "Missing clickable " + selector);
  if (point === null) return;
  window.focus();
  window.webContents.sendInputEvent({ type: "mouseMove", x: point.x, y: point.y });
  window.webContents.sendInputEvent({ type: "mouseDown", x: point.x, y: point.y, button: "left", clickCount: 1 });
  window.webContents.sendInputEvent({ type: "mouseUp", x: point.x, y: point.y, button: "left", clickCount: 1 });
}

async function fill(window: BrowserWindow, selector: string, textValue: string): Promise<void> {
  await window.webContents.executeJavaScript("(() => { const e=document.querySelector(" + JSON.stringify(selector) + "); if (!(e instanceof HTMLTextAreaElement || e instanceof HTMLInputElement)) throw new Error('Missing editable control'); const p=e instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(p,'value').set.call(e," + JSON.stringify(textValue) + "); e.dispatchEvent(new Event('input',{bubbles:true})); })()");
}

async function value(window: BrowserWindow, selector: string): Promise<string> {
  return window.webContents.executeJavaScript("document.querySelector(" + JSON.stringify(selector) + ")?.value ?? ''");
}

async function text(window: BrowserWindow, selector: string): Promise<string> {
  return window.webContents.executeJavaScript("document.querySelector(" + JSON.stringify(selector) + ")?.textContent ?? ''");
}

async function disabled(window: BrowserWindow, selector: string): Promise<boolean> {
  return window.webContents.executeJavaScript("document.querySelector(" + JSON.stringify(selector) + ")?.disabled ?? true");
}

async function waitFor(window: BrowserWindow, expression: string, maxWaitMs = Math.max(1_000, deadline - Date.now())): Promise<void> {
  const until = Math.min(deadline, Date.now() + maxWaitMs);
  while (Date.now() < until) {
    if (await window.webContents.executeJavaScript("Boolean(" + expression + ")")) return;
    await delay(100);
  }
  throw new Error("Timed out waiting for " + expression);
}

async function writeEvidence(evidence: Evidence): Promise<void> {
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "f5-6a-node.json"), JSON.stringify(evidence, null, 2));
}

async function settleRenderer(window: BrowserWindow): Promise<void> {
  await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}

function delay(ms: number): Promise<void> {
  return new Promise(resolveDelay => setTimeout(resolveDelay, ms));
}

void main().then(() => app.exit(0), error => {
  process.stderr.write((error instanceof Error ? error.stack ?? error.message : String(error)) + "\n");
  app.exit(1);
});
