import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { app, BrowserWindow } from "electron";
import { resolveHostLaunchConfig } from "../../electron/host/launch.js";
import { KernelHostProcess } from "../../electron/host/process.js";
import { registerProjectIpc } from "../../electron/ipc/project.js";
import { ProjectController } from "../../electron/ipc/project/controller.js";
import type { ProjectHost } from "../../electron/ipc/project/handler.js";
import { ControlledProjectHost } from "./controlled.js";
import type { ProjectDetailV1, ProjectListV1 } from "../../rpc/project.js";

const mode = process.env.NAVO_HOST_MODE ?? "real";
const timeoutMs = Number(process.env.NAVO_QA_TIMEOUT_MS ?? 900_000);
const deadline = Date.now() + timeoutMs;
const maxUserTurns = 12;
const maxSteps = 10;
const output = resolve(process.env.NAVO_QA_OUTPUT ?? join(tmpdir(), "navo-f54-evidence-" + Date.now()));
const evidenceHome = process.env.NAVO_HOME ?? (mode === "mock" || mode === "controlled" ? join(tmpdir(), "navo-f54-home-" + process.pid) : null);
if (evidenceHome === null) throw new Error("真实 F5.4 验收必须由调用方提供隔离 NAVO_HOME");
process.env.NAVO_HOME = evidenceHome;
process.env.NAVO_HOST_MODE = mode;
process.env.NAVO_REPO_ROOT ??= resolve("..");
app.setPath("userData", join(tmpdir(), "navo-f54-electron-" + process.pid));

interface Evidence {
  readonly mode: string;
  readonly renderer: string;
  readonly output: string;
  readonly timeoutMs: number;
  readonly workspace: string;
  firstProject?: unknown;
  secondProject?: unknown;
  layout?: unknown;
  status?: "passed" | "failed";
  error?: string;
  screenshot?: string;
  budget?: { readonly userTurns: number; readonly stepStarted: number; readonly maxUserTurns: number; readonly maxSteps: number };
  fixture?: { readonly firstTurnFailed: boolean; readonly userTurns: number; readonly userMessages: number; readonly confirmSent: boolean };
}

async function main(): Promise<void> {
  await app.whenReady();
  await mkdir(output, { recursive: true });
  const workspace = await mkdtemp(join(tmpdir(), "navo-f54-workspace-"));
  const host: ProjectHost = mode === "controlled" || mode === "controlled-failure"
    ? new ControlledProjectHost({ failFirstTurn: mode === "controlled-failure" })
    : new KernelHostProcess(resolveHostLaunchConfig({ appPath: app.getAppPath() }));
  const hostProcess = host instanceof KernelHostProcess ? host : null;
  const controller = new ProjectController(host);
  let choice: string | null = workspace;
  const unregister = registerProjectIpc(host, async () => choice === null
    ? { canceled: true, filePaths: [] } : { canceled: false, filePaths: [choice] }, controller);
  const window = new BrowserWindow({
    width: 1280, height: 800, show: false,
    webPreferences: { preload: resolve("out/preload/index.js"), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  const evidence: Evidence = { mode, renderer: process.env.ELECTRON_RENDERER_URL === undefined ? "built" : "development", output, timeoutMs, workspace };
  let passed = false;
  let timer: NodeJS.Timeout | undefined;
  try {
    const flow = runFlow(window, host, evidence, async value => { choice = value; });
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        void hostProcess?.close();
        if (!window.isDestroyed()) window.destroy();
        reject(new Error("F5.4 QA exceeded " + timeoutMs + "ms"));
      }, timeoutMs);
    });
    await Promise.race([flow, timeout]);
    evidence.status = "passed";
    await writeEvidence(evidence);
    passed = true;
  } catch (error: unknown) {
    evidence.status = "failed";
    evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
    if (!window.isDestroyed()) {
      try {
        const screenshot = join(output, "f5-4-" + mode + "-failure.png");
        await writeFile(screenshot, (await window.webContents.capturePage()).toPNG());
        evidence.screenshot = screenshot;
      } catch { }
    }
    await writeEvidence(evidence);
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    unregister();
    controller.dispose();
    if (!window.isDestroyed()) window.destroy();
    await hostProcess?.close();
    if (passed) {
      const { rm } = await import("node:fs/promises");
      await rm(workspace, { recursive: true, force: true });
    }
  }
}

async function runFlow(window: BrowserWindow, host: ProjectHost, evidence: Evidence, setChoice: (value: string) => Promise<void>): Promise<void> {
  if (host instanceof KernelHostProcess) await host.start();
  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl === undefined) await window.loadFile(resolve("out/renderer/index.html"));
  else await window.loadURL(rendererUrl);
  window.show();
  await installBudget(window);
  await click(window, '[aria-label="侧栏视图"] button', "项目");
  await waitFor(window, "document.querySelector('nav[aria-label=\"项目列表\"]')?.textContent.includes('暂无项目')");

  const first = "F5.4 QA " + Date.now();
  const firstId = await createProject(window, first, "比较列表式与看板式待办清单，按上手成本和维护成本给出短文建议；不联网、不执行 Shell 或文件操作。", evidence.workspace, setChoice);
  const firstPanel = panel(first);
  await waitFor(window, "document.querySelector(" + JSON.stringify(firstPanel) + ") !== null");
  if (mode === "controlled-failure") {
    await runFailureFixture(window, firstPanel, firstId, evidence);
    throw new Error("controlled failure fixture completed");
  }
  await assertConversationVisible(window, firstPanel, "宽屏初始");
  await clickAt(window, firstPanel + ' button[aria-label="收起会话面板"]');
  await waitFor(window, "document.querySelector(" + JSON.stringify(firstPanel) + ")?.querySelector('button[aria-label=\"展开会话面板\"]') !== null && document.querySelector(" + JSON.stringify(firstPanel) + ")?.querySelector('[aria-label=\"项目会话面板\"]') === null");
  await settleRenderer(window);
  await delay(300);
  await assertElementVisible(window, firstPanel + ' button[aria-label="展开会话面板"]', "宽屏收起后的恢复入口", false);
  await clickAt(window, firstPanel + ' button[aria-label="展开会话面板"]');
  await waitFor(window, "document.querySelector(" + JSON.stringify(firstPanel) + ")?.querySelector('[aria-label=\"项目会话面板\"]') !== null");
  await settleRenderer(window);
  await assertConversationVisible(window, firstPanel, "宽屏展开");
  await runConversation(window, firstPanel, firstId, false, "请复述当前目标，并明确不联网、不执行 Shell 或文件操作；在我确认前不要规划。", "我确认目标是比较列表式与看板式待办清单，按上手成本和维护成本给出短文建议；不联网、不执行 Shell 或文件操作。请现在创建恰好两个节点的执行路线。");
  evidence.firstProject = await projectState(window, firstId);
  await writeFile(join(output, "f5-4-" + mode + "-wide.png"), (await window.webContents.capturePage()).toPNG());

  await fill(window, firstPanel + " textarea", "第一项目未发送草稿");
  const secondWorkspace = join(evidence.workspace, "second");
  await (await import("node:fs/promises")).mkdir(secondWorkspace);
  const second = first + " 空目标";
  const secondId = await createProject(window, second, "", secondWorkspace, setChoice);
  const secondPanel = panel(second);
  await waitFor(window, "document.querySelector(" + JSON.stringify(secondPanel) + ") !== null");
  await fill(window, secondPanel + " textarea", "第二项目独立草稿");
  assert.equal(await value(window, firstPanel + " textarea"), "第一项目未发送草稿");
  assert.equal(await value(window, secondPanel + " textarea"), "第二项目独立草稿");
  await runConversation(window, secondPanel, secondId, true, "请提出一个具体目标：比较本地文件夹与逻辑资料夹的整理方式，按上手成本和维护成本给出短文建议；不联网、不执行 Shell 或文件操作。先复述并等待确认，不要规划。", "我确认目标是比较本地文件夹与逻辑资料夹的整理方式，按上手成本和维护成本给出短文建议；不联网、不执行 Shell 或文件操作。请现在创建恰好两个节点的执行路线。");
  evidence.secondProject = await projectState(window, secondId);

  await click(window, 'button[aria-label="关闭 ' + first + '"]');
  await click(window, 'nav[aria-label="项目列表"] button', second);
  await click(window, 'nav[aria-label="项目列表"] button', first);
  await waitFor(window, "document.querySelector(" + JSON.stringify(firstPanel) + ")?.textContent.includes('请复述当前目标')");
  const reopened = await projectState(window, firstId);
  assert.equal(reopened.type, "ok");
  if (reopened.type === "ok") {
    assert.ok(reopened.value.roadmap !== null, "reopened project did not retain its roadmap");
    assert.equal(reopened.value.roadmap.nodes.length, 2, "reopened roadmap must contain exactly two nodes");
  }

  window.setContentSize(547, 760);
  await settleRenderer(window);
  await assertConversationVisible(window, firstPanel, "窄屏展开", false);
  const userTurns = await recordUserTurn(window);
  assert.ok(userTurns <= maxUserTurns, "F5.4 QA user-turn budget exceeded");
  await fill(window, firstPanel + " textarea", "停止前的在途回合");
  await clickAt(window, firstPanel + ' button[aria-label="发送消息"]');
  await waitFor(window, "document.querySelector(" + JSON.stringify(firstPanel) + ")?.querySelector('button[aria-label=\"停止生成\"]') !== null", 5_000);
  await assertElementVisible(window, firstPanel + ' button[aria-label="停止生成"]', "窄屏停止按钮", false);
  await clickAt(window, firstPanel + ' button[aria-label="停止生成"]');
  await waitFor(window, "document.querySelector(" + JSON.stringify(firstPanel) + ")?.textContent.includes('已停止生成') || document.querySelector(" + JSON.stringify(firstPanel) + ")?.querySelector('button[aria-label=\"停止生成\"]') === null");

  const layout = await window.webContents.executeJavaScript("({ viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth })");
  assert.ok(layout.scrollWidth <= layout.viewport);
  evidence.layout = layout;
  evidence.budget = await readBudget(window);
  await writeFile(join(output, "f5-4-" + mode + ".png"), (await window.webContents.capturePage()).toPNG());
  await writeEvidence(evidence);
}

async function runConversation(window: BrowserWindow, selector: string, projectId: string, emptyGoal: boolean, recap: string, confirm: string): Promise<void> {
  await send(window, selector, recap);
  const before = await projectState(window, projectId);
  assert.equal(before.type, "ok");
  if (before.type !== "ok") return;
  assert.equal(before.value.roadmap, null, "roadmap appeared before explicit confirmation");
  if (emptyGoal) assert.equal(before.value.project.goal, null, "empty project gained a goal before confirmation");
  await send(window, selector, confirm);
  const after = await waitForRoadmap(window, projectId);
  assert.equal(after.type, "ok");
  if (after.type === "ok") {
    assert.ok(after.value.roadmap !== null, "explicit confirmation did not produce a roadmap");
    assert.equal(after.value.roadmap.nodes.length, 2, "explicit confirmation must produce exactly two nodes");
    assert.notEqual(after.value.project.goal, null, "confirmed project goal is still empty");
  }
}

async function send(window: BrowserWindow, selector: string, textValue: string): Promise<void> {
  const userTurns = await recordUserTurn(window);
  assert.ok(userTurns <= maxUserTurns, "F5.4 QA user-turn budget exceeded");
  const beforeReplies = await countReplies(window, selector);
  await fill(window, selector + " textarea", textValue);
  assert.equal(await value(window, selector + " textarea"), textValue);
  await waitFor(window, "!document.querySelector(" + JSON.stringify(selector) + ")?.querySelector('button[aria-label=\"发送消息\"]')?.hasAttribute('disabled')");
  await settleRenderer(window);
  await assertConversationVisible(window, selector, "发送前", false);
  await clickAt(window, selector + ' button[aria-label="发送消息"]');
  await waitFor(window, "document.querySelector(" + JSON.stringify(selector) + ")?.querySelector('textarea')?.value === ''");
  const result = await waitForReply(window, selector, beforeReplies, 120_000);
  if (result.status !== "completed") throw new Error("Turn " + result.status + ": " + result.text);
}

async function runFailureFixture(window: BrowserWindow, selector: string, projectId: string, evidence: Evidence): Promise<void> {
  let failure: unknown = null;
  try {
    await send(window, selector, "请复述当前目标，并在我确认前不要规划。");
  } catch (error: unknown) {
    failure = error;
  }
  assert.ok(failure instanceof Error && failure.message.startsWith("Turn failed:"), "controlled fixture did not fail the first turn");
  const userTurns = (await readBudget(window)).userTurns;
  const userMessages = await countUserMessages(window, selector);
  const state = await projectState(window, projectId);
  assert.equal(userTurns, 1, "controlled fixture sent more than one user turn");
  assert.equal(userMessages, 1, "controlled fixture rendered more than one user message");
  assert.equal(state.type, "ok");
  if (state.type === "ok") assert.equal(state.value.roadmap, null, "controlled fixture created a roadmap after failure");
  evidence.fixture = { firstTurnFailed: true, userTurns, userMessages, confirmSent: false };
}

async function countReplies(window: BrowserWindow, selector: string): Promise<number> {
  return window.webContents.executeJavaScript("document.querySelector(" + JSON.stringify(selector) + ")?.querySelectorAll('[aria-label=\"Agent 回复\"]').length ?? 0");
}

async function countUserMessages(window: BrowserWindow, selector: string): Promise<number> {
  return window.webContents.executeJavaScript("document.querySelector(" + JSON.stringify(selector) + ")?.querySelectorAll('[aria-label=\"你的消息\"]').length ?? 0");
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

async function installBudget(window: BrowserWindow): Promise<void> {
  await window.webContents.executeJavaScript("(() => { window.__f54Budget = { userTurns: 0, stepStarted: 0 }; window.desktop.project.onEvent(event => { if (event.type === 'turn-event' && event.event.type === 'step-started') { window.__f54Budget.stepStarted += 1; if (window.__f54Budget.stepStarted >= " + maxSteps + ") void window.desktop.project.cancel(event.operationId); } }); })()");
}

async function recordUserTurn(window: BrowserWindow): Promise<number> {
  return window.webContents.executeJavaScript("(() => { window.__f54Budget.userTurns += 1; return window.__f54Budget.userTurns; })()");
}

async function readBudget(window: BrowserWindow): Promise<{ readonly userTurns: number; readonly stepStarted: number; readonly maxUserTurns: number; readonly maxSteps: number }> {
  const current: { readonly userTurns: number; readonly stepStarted: number } = await window.webContents.executeJavaScript("window.__f54Budget");
  return { ...current, maxUserTurns, maxSteps };
}

async function assertConversationVisible(window: BrowserWindow, selector: string, label: string, requireSendHit = true): Promise<void> {
  const geometry = await window.webContents.executeJavaScript("(() => { const article=document.querySelector(" + JSON.stringify(selector) + "); const panel=article?.querySelector('[aria-label=\"项目会话面板\"]'); const input=panel?.querySelector('textarea'); const send=panel?.querySelector('button[aria-label=\"发送消息\"]'); const box=(element) => { if (!(element instanceof HTMLElement)) return null; const rect=element.getBoundingClientRect(); const style=getComputedStyle(element); const visible=rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden' && style.opacity !== '0'; const x=Math.max(rect.left + 1, Math.min(rect.right - 1, innerWidth / 2)); const y=Math.max(rect.top + 1, Math.min(rect.bottom - 1, innerHeight / 2)); const hit=document.elementFromPoint(x,y); const points=[[rect.left+2,rect.top+2],[rect.right-2,rect.top+2],[rect.left+2,rect.bottom-2],[rect.right-2,rect.bottom-2],[x,y]]; const hits=points.map(([px,py]) => { const target=document.elementFromPoint(px,py); return { tag:target?.tagName ?? null, className:target?.className ?? null, own:target===element || element.contains(target) }; }); return { visible, hit: hit !== null && (hit===element || element.contains(hit)), hitTag:hit?.tagName ?? null, hitClass:hit?.className ?? null, hitAria:hit?.getAttribute?.('aria-label') ?? null, hits, pointerEvents:style.pointerEvents, zIndex:style.zIndex, disabled:element instanceof HTMLButtonElement ? element.disabled : null, left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom, width:rect.width, height:rect.height }; }; return { panel:box(panel), input:box(input), send:box(send), allProjects:[...document.querySelectorAll('article[aria-label^=\"项目 \"]')].map(item => ({ aria:item.getAttribute('aria-label'), rect:(item instanceof HTMLElement ? (()=>{ const r=item.getBoundingClientRect(); return {left:r.left,top:r.top,right:r.right,bottom:r.bottom}; })() : null), active:item.closest('section')?.getAttribute('data-active'), inert:item.closest('section')?.hasAttribute('inert') })), viewport:{ width:innerWidth, height:innerHeight } }; })()");
  assert.ok(geometry.panel?.visible && geometry.panel.hit, label + " 项目会话面板不可见或不可命中: " + JSON.stringify(geometry));
  assert.ok(geometry.input?.visible && geometry.input.hit, label + " 输入框不可见或不可命中: " + JSON.stringify(geometry));
  assert.ok(geometry.send?.visible, label + " 发送按钮不可见: " + JSON.stringify(geometry));
  const disabled = await window.webContents.executeJavaScript("document.querySelector(" + JSON.stringify(selector) + ")?.querySelector('button[aria-label=\"发送消息\"]')?.hasAttribute('disabled')");
  if (requireSendHit) assert.ok(geometry.send?.hit || disabled, label + " 发送按钮不可命中: " + JSON.stringify(geometry));
}

async function assertElementVisible(window: BrowserWindow, selector: string, label: string, requireHit = true): Promise<void> {
  const geometry = await window.webContents.executeJavaScript("(() => { const elements=[...document.querySelectorAll(" + JSON.stringify(selector) + ")]; const element=elements[0]; if (!(element instanceof HTMLElement)) return null; const rect=element.getBoundingClientRect(); const style=getComputedStyle(element); const x=Math.max(rect.left + 1, Math.min(rect.right - 1, innerWidth / 2)); const y=Math.max(rect.top + 1, Math.min(rect.bottom - 1, innerHeight / 2)); const hit=document.elementFromPoint(x,y); const points=[[rect.left+2,rect.top+2],[rect.right-2,rect.top+2],[rect.left+2,rect.bottom-2],[rect.right-2,rect.bottom-2],[x,y]]; const hits=points.map(([px,py]) => { const target=document.elementFromPoint(px,py); return { x:px, y:py, tag:target?.tagName ?? null, className:target?.className ?? null, own:target===element || element.contains(target) }; }); const ancestors=[]; for(let item=element; item instanceof HTMLElement && ancestors.length<5; item=item.parentElement){ const current=getComputedStyle(item); ancestors.push({ tag:item.tagName, className:item.className, pointerEvents:current.pointerEvents, visibility:current.visibility, zIndex:current.zIndex, overflow:current.overflow, inert:item.hasAttribute('inert'), ariaHidden:item.getAttribute('aria-hidden') }); } return { count:elements.length, visible:rect.width > 0 && rect.height > 0 && style.display !== 'none' && style.visibility !== 'hidden', hit:hit === element || element.contains(hit), hitTag:hit?.tagName ?? null, hitClass:hit?.className ?? null, hitAria:hit?.getAttribute?.('aria-label') ?? null, hits, stack:[...document.elementsFromPoint(x,y)].slice(0,5).map(item => ({ tag:item.tagName, className:item.className, aria:item.getAttribute?.('aria-label'), inert:item.hasAttribute?.('inert') })), ancestors, zIndex:style.zIndex, pointerEvents:style.pointerEvents, left:rect.left, top:rect.top, right:rect.right, bottom:rect.bottom }; })()");
  assert.ok(geometry?.visible, label + " 不可见: " + JSON.stringify(geometry));
  if (requireHit) assert.ok(geometry.hit, label + " 不可命中: " + JSON.stringify(geometry));
}

async function createProject(window: BrowserWindow, name: string, goal: string, workspace: string, setChoice: (value: string) => Promise<void>): Promise<string> {
  await click(window, 'button[class*="create"]');
  await waitFor(window, "document.querySelector('dialog[open]') !== null");
  await fill(window, 'dialog input[name="name"]', name);
  if (goal) await fill(window, 'dialog textarea[name="goal"]', goal);
  await setChoice(workspace);
  await click(window, 'dialog button', "选择目录");
  await waitFor(window, "document.querySelector('dialog code')?.textContent === " + JSON.stringify(workspace));
  await click(window, 'dialog button[type="submit"]');
  return waitForProject(window, name);
}

function panel(name: string): string { return 'article[aria-label=' + JSON.stringify("项目 " + name) + ']'; }

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
  throw new Error("Timed out waiting for created project " + name);
}

async function waitForRoadmap(window: BrowserWindow, projectId: string): Promise<BrowserResult<ProjectDetailV1>> {
  const until = Math.min(deadline, Date.now() + 10_000);
  while (Date.now() < until) {
    const result = await projectState(window, projectId);
    if (result.type === "ok" && result.value.roadmap !== null && result.value.roadmap.nodes.length === 2) return result;
    await delay(100);
  }
  throw new Error("Completed confirmation turn without a roadmap for " + projectId);
}

async function click(window: BrowserWindow, selector: string, label?: string): Promise<void> {
  const predicate = label === undefined ? "true" : "(x.getAttribute('aria-label')??x.textContent).trim()===" + JSON.stringify(label);
  const clicked = await window.webContents.executeJavaScript("(() => { const e=[...document.querySelectorAll(" + JSON.stringify(selector) + ")].find(x=>" + predicate + "); e?.click(); return e!==undefined; })()");
  assert.ok(clicked, "Missing " + selector + " " + (label ?? ""));
}

async function clickAt(window: BrowserWindow, selector: string, label?: string): Promise<void> {
  const predicate = label === undefined ? "true" : "(x.getAttribute('aria-label')??x.textContent).trim()===" + JSON.stringify(label);
  const point: { readonly x: number; readonly y: number } | null = await window.webContents.executeJavaScript("(() => { const e=[...document.querySelectorAll(" + JSON.stringify(selector) + ")].find(x=>" + predicate + "); if (!(e instanceof HTMLElement)) return null; const rect=e.getBoundingClientRect(); return { x:(rect.left+rect.right)/2, y:(rect.top+rect.bottom)/2 }; })()");
  assert.ok(point !== null, "Missing clickable " + selector + " " + (label ?? ""));
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
  await writeFile(join(output, "f5-4-" + mode + ".json"), JSON.stringify(evidence, null, 2));
}

function delay(ms: number): Promise<void> { return new Promise(resolveDelay => setTimeout(resolveDelay, ms)); }

async function settleRenderer(window: BrowserWindow): Promise<void> {
  await window.webContents.executeJavaScript("new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)))");
}

void main().catch(error => { console.error(error instanceof Error ? error.stack ?? error.message : error); app.exit(1); });

