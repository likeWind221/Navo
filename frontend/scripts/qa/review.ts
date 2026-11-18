import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { app, BrowserWindow } from "electron";
import type { NodeV1, ProjectDetailV1, ProjectListV1 } from "../../../rpc/project.js";
import { registerProjectIpc } from "../../electron/ipc/project.js";
import { ProjectController } from "../../electron/ipc/project/controller.js";
import { ControlledProjectHost } from "./controlled.js";

const timeoutMs = Number(process.env.NAVO_QA_TIMEOUT_MS ?? 180_000);
const deadline = Date.now() + timeoutMs;
const output = resolve(process.env.NAVO_QA_OUTPUT ?? join(tmpdir(), "navo-f56b-qa"));
process.env.NAVO_HOST_MODE = "controlled";
process.env.NAVO_REPO_ROOT ??= resolve("..");
app.setPath("userData", join(tmpdir(), "navo-f56b-electron-" + process.pid));
app.on("window-all-closed", () => undefined);

interface Evidence {
  readonly mode: "controlled";
  readonly output: string;
  readonly timeoutMs: number;
  status?: "passed" | "failed";
  error?: string;
  submitted?: unknown;
  mainReview?: unknown;
  conflict?: unknown;
  completion?: unknown;
  rework?: unknown;
  skipped?: unknown;
  turns?: unknown;
  reviews?: unknown;
  layout?: unknown;
  modelCalls?: number;
  screenshots?: string[];
}

async function main(): Promise<void> {
  await app.whenReady();
  await mkdir(output, { recursive: true });
  const workspace = await mkdtemp(join(tmpdir(), "navo-f56b-workspace-"));
  const host = new ControlledProjectHost({ submitNodeOnFinish: true });
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
      timer = setTimeout(() => reject(new Error("F5.6b QA exceeded " + timeoutMs + "ms")), timeoutMs);
    });
    await Promise.race([flow, timeout]);
    evidence.status = "passed";
    await writeEvidence(evidence);
  } catch (error: unknown) {
    evidence.status = "failed";
    evidence.error = error instanceof Error ? error.stack ?? error.message : String(error);
    if (!window.isDestroyed()) {
      const screenshot = join(output, "f5-6b-failure.png");
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

  const name = "F5.6b QA " + Date.now();
  const projectId = await createProject(window, name, "验证作业验收、Main 复盘、版本冲突和人工确认；不调用真实模型。");
  const panel = "article[aria-label=" + JSON.stringify("项目 " + name) + "]";
  await waitFor(window, "document.querySelector(" + JSON.stringify(panel) + ") !== null");
  await send(window, panel, "我确认目标。请创建恰好两个节点的执行路线，第一个可执行，第二个锁定。");
  const planned = await waitForRoadmap(window, projectId);
  assert.equal(planned.roadmap?.nodes.length, 2);

  const nodeOneButton = 'button[data-node-id="controlled-node-1"]';
  const nodeTwoButton = 'button[data-node-id="controlled-node-2"]';
  const nodeOneInput = "#project-" + projectId + "-node-controlled-node-1-chat-input";
  const nodeTwoInput = "#project-" + projectId + "-node-controlled-node-2-chat-input";
  const reviewArea = 'section[aria-label="节点验收"]';
  const reasonInput = reviewArea + " textarea";
  const submitReview = reviewArea + " form button[type=submit]";

  await waitFor(window, "document.querySelector(" + JSON.stringify(nodeOneButton) + ")?.hidden === false");
  await settleRenderer(window);
  await clickAt(window, nodeOneButton);
  await waitFor(window, "document.querySelector(" + JSON.stringify(nodeOneInput) + ") !== null");
  await send(window, panel, "第一次执行并提交作业");
  const submitted = await waitForNode(window, projectId, "controlled-node-1", node => node.status === "submitted");
  assert.match(submitted.submission?.summary ?? "", /完成资料整理/);
  assert.equal(submitted.reviewPending, true);
  await waitForText(window, reviewArea, "完成资料整理并保留出处");
  await waitForText(window, reviewArea, "controlled-resource-1");
  await waitForText(window, reviewArea, "补充 2024 年来源");
  await waitForText(window, reviewArea, "待复盘");
  const submittedMarkup = await text(window, 'section[aria-label="节点验收"]');
  assert.ok(!submittedMarkup.includes("✓ 已完成"));
  evidence.submitted = {
    status: submitted.status,
    summary: submitted.submission?.summary,
    resourceIds: submitted.submission?.resourceIds,
    remaining: submitted.submission?.remaining,
    reviewPending: submitted.reviewPending,
  };

  const wide = join(output, "f5-6b-review-wide.png");
  const narrow = join(output, "f5-6b-review-narrow.png");
  window.setContentSize(1280, 900);
  await window.webContents.executeJavaScript("document.querySelector(" + JSON.stringify(reviewArea) + ")?.scrollIntoView({ block: 'center' })");
  await settleRenderer(window);
  await writeFile(wide, (await window.webContents.capturePage()).toPNG());
  await click(window, "button", "收起侧栏");
  window.setContentSize(547, 760);
  await waitFor(window, "innerWidth <= 547");
  await click(window, "button", "完全展开会话面板");
  await window.webContents.executeJavaScript("document.querySelector(" + JSON.stringify(reviewArea + ' section[aria-label="验收操作"]') + ")?.scrollIntoView({ block: 'center' })");
  await settleRenderer(window);
  const layout = await window.webContents.executeJavaScript("(() => { const rect=document.querySelector(" + JSON.stringify(reviewArea) + ")?.getBoundingClientRect(); return { viewport: innerWidth, scrollWidth: document.documentElement.scrollWidth, pageLeft: document.documentElement.scrollLeft, reviewLeft: rect?.left ?? null, reviewRight: rect?.right ?? null, reviewWidth: rect?.width ?? null, reviewTop: rect?.top ?? null, reviewBottom: rect?.bottom ?? null }; })()");
  assert.ok(layout.scrollWidth <= layout.viewport);
  await writeFile(narrow, (await window.webContents.capturePage()).toPNG());
  const narrowAfterCapture = await window.webContents.executeJavaScript("({ viewport: innerWidth, content: [document.body.clientWidth, document.body.clientHeight] })");
  const narrowWindow = window.getContentSize();
  await click(window, "button", "恢复普通宽度");
  window.setContentSize(1280, 900);
  await click(window, "button", "展开侧栏");
  await settleRenderer(window);
  evidence.layout = { ...layout, window: narrowWindow, afterCapture: narrowAfterCapture };
  evidence.screenshots = [wide, narrow];

  const turnsBeforeReview = host.turnInputs.length;
  const repliesBeforeReview = await countReplies(window, panel);
  await clickAt(window, reviewArea + ' button[data-action="review"]');
  await waitForCondition(() => host.turnInputs.length === turnsBeforeReview + 1);
  assert.deepEqual(host.turnInputs.at(-1)?.target, { kind: "review", nodeId: "controlled-node-1" });
  const reviewReply = await waitForReply(window, panel, repliesBeforeReview, 10_000);
  assert.equal(reviewReply.status, "completed");
  assert.ok(reviewReply.text.includes("复盘完成"));
  const reviewed = await waitForNode(window, projectId, "controlled-node-1", node => node.reworkCount === 1 && node.status === "idle");
  await waitForText(window, reviewArea, "补充 2024 年来源后重新提交");
  await waitForText(window, reviewArea, "证据链仍不完整");
  evidence.mainReview = {
    target: host.turnInputs.at(-1)?.target,
    text: host.turnInputs.at(-1)?.text,
    reply: reviewReply.text,
    status: reviewed.status,
    reworkCount: reviewed.reworkCount,
    decision: reviewed.review?.decision,
  };

  await waitFor(window, "document.querySelector(" + JSON.stringify(nodeOneInput) + ") !== null");
  await send(window, panel, "补齐来源后再次提交");
  await waitForNode(window, projectId, "controlled-node-1", node => node.status === "submitted" && node.reviewPending);

  host.setReviewDelay(700);
  host.rejectNextReview();
  await clickAt(window, reviewArea + ' button[data-action="complete"]');
  await waitFor(window, "document.querySelector(" + JSON.stringify(reasonInput) + ") !== null");
  await fill(window, reasonInput, "冲突前的人工验收");
  const turnsBeforeManual = host.turnInputs.length;
  await click(window, submitReview);
  await waitForText(window, reviewArea, "提交中");
  await waitForCondition(() => host.reviewInputs.length === 1);
  assert.equal((await projectState(window, projectId)).type, "ok");
  const duringReview = await waitForNode(window, projectId, "controlled-node-1", node => node.status === "submitted");
  assert.ok(!(await text(window, reviewArea)).includes("人工确认记录"));
  await waitForText(window, reviewArea, "节点版本已变化");
  await waitForText(window, reviewArea, "另一份最新作业版本");
  await delay(500);
  assert.equal(host.reviewInputs.length, 1);
  assert.equal(host.turnInputs.length, turnsBeforeManual);
  const latest = await waitForNode(window, projectId, "controlled-node-1", node => node.submission?.summary === "另一份最新作业版本");
  evidence.conflict = {
    status: duringReview.status,
    latestSummary: latest.submission?.summary,
    reviewInputs: host.reviewInputs.length,
    automaticTurns: host.turnInputs.length - turnsBeforeManual,
  };

  host.setReviewDelay(500);
  await fill(window, reasonInput, "重试后人工通过");
  await click(window, submitReview);
  await waitForText(window, reviewArea, "提交中");
  const optimistic = await waitForNode(window, projectId, "controlled-node-1", node => node.status === "submitted");
  assert.equal(optimistic.status, "submitted");
  const completed = await waitForNode(window, projectId, "controlled-node-1", node => node.status === "completing");
  assert.match(completed.confirmation?.reason ?? "", /重试后人工通过/);
  await waitForText(window, reviewArea, "人工确认记录");
  assert.equal(host.turnInputs.length, turnsBeforeManual);
  evidence.completion = {
    status: completed.status,
    reason: completed.confirmation?.reason,
    reviewInputs: host.reviewInputs.length,
  };

  await waitForNode(window, projectId, "controlled-node-2", node => node.actions.run);
  await clickAt(window, nodeTwoButton);
  await waitFor(window, "document.querySelector(" + JSON.stringify(nodeTwoInput) + ") !== null");
  await send(window, panel, "执行第二个节点");
  await waitForNode(window, projectId, "controlled-node-2", node => node.status === "submitted");
  const reason = "第二个节点补充真实来源";
  await clickAt(window, reviewArea + ' button[data-action="rework"]');
  await waitFor(window, "document.querySelector(" + JSON.stringify(reasonInput) + ") !== null");
  await fill(window, reasonInput, reason);
  await click(window, submitReview);
  const reworked = await waitForNode(window, projectId, "controlled-node-2", node => node.status === "idle" && node.reviewPending === false);
  await waitForText(window, reviewArea, reason);
  evidence.rework = { status: reworked.status, feedback: reworked.pendingFeedback?.feedback, reworkCount: reworked.reworkCount };

  await send(window, panel, "按返工意见重新执行");
  await waitForNode(window, projectId, "controlled-node-2", node => node.status === "submitted");
  await clickAt(window, reviewArea + ' button[data-action="skip"]');
  await waitFor(window, "document.querySelector(" + JSON.stringify(reasonInput) + ") !== null");
  await click(window, submitReview);
  const skipped = await waitForNode(window, projectId, "controlled-node-2", node => node.status === "skipped");
  await waitForText(window, reviewArea, "人工决定跳过");
  evidence.skipped = { status: skipped.status, reason: skipped.confirmation?.reason };
  evidence.turns = host.turnInputs.map(input => ({ text: input.text, target: input.target }));
  evidence.reviews = host.reviewInputs.map(input => ({ nodeId: input.nodeId, action: input.action, reason: input.reason, reviewedRevision: input.reviewedRevision }));
  evidence.modelCalls = 0;
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

async function waitForNode(window: BrowserWindow, projectId: string, nodeId: string, predicate: (node: NodeV1) => boolean): Promise<NodeV1> {
  while (Date.now() < deadline) {
    const result = await projectState(window, projectId);
    const node = result.type === "ok" ? result.value.roadmap?.nodes.find(item => item.nodeId === nodeId) : undefined;
    if (node !== undefined && predicate(node)) return node;
    await delay(100);
  }
  throw new Error("Timed out waiting for node " + nodeId);
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
  await window.webContents.executeJavaScript("document.querySelector(" + JSON.stringify(selector) + ")?.scrollIntoView({ block: 'center' })");
  await settleRenderer(window);
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

async function waitForText(window: BrowserWindow, selector: string, expected: string, maxWaitMs = 10_000): Promise<void> {
  const until = Math.min(deadline, Date.now() + maxWaitMs);
  while (Date.now() < until) {
    if ((await text(window, selector)).includes(expected)) return;
    await delay(100);
  }
  throw new Error("Timed out waiting for text " + expected);
}

async function waitForCondition(predicate: () => boolean, maxWaitMs = 10_000): Promise<void> {
  const until = Math.min(deadline, Date.now() + maxWaitMs);
  while (Date.now() < until) {
    if (predicate()) return;
    await delay(50);
  }
  throw new Error("Timed out waiting for controlled Host state");
}

async function waitFor(window: BrowserWindow, expression: string, maxWaitMs = 10_000): Promise<void> {
  const until = Math.min(deadline, Date.now() + maxWaitMs);
  while (Date.now() < until) {
    if (await window.webContents.executeJavaScript("Boolean(" + expression + ")")) return;
    await delay(100);
  }
  throw new Error("Timed out waiting for " + expression);
}

async function writeEvidence(evidence: Evidence): Promise<void> {
  await mkdir(output, { recursive: true });
  await writeFile(join(output, "f5-6b-review.json"), JSON.stringify(evidence, null, 2));
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
