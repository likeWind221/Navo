import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { app, BrowserWindow } from "electron";
import { projectNodeReviewMethod, projectTurnMethod } from "../../../rpc/project.js";
import type { AutoRunSnapshotV1, ProjectDetailV1, ProjectSummaryV1 } from "../../../rpc/project.js";
import { resolveHostLaunchConfig } from "../../electron/host/launch.js";
import { KernelHostProcess } from "../../electron/host/process.js";
import { registerProjectIpc } from "../../electron/ipc/project.js";
import type { DesktopProjectApi, DesktopProjectResult } from "../../shared/project.js";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "navo-f113-desktop-"));
  const output = resolve(process.env.NAVO_QA_OUTPUT ?? join(tmpdir(), `navo-f113-evidence-${Date.now()}`));
  process.env.NAVO_HOST_MODE = "mock";
  process.env.NAVO_MOCK_LLM_MODE = "roadmap";
  process.env.NAVO_REPO_ROOT = resolve("..");
  process.env.NAVO_HOME = join(root, "home");
  app.setPath("userData", join(root, "electron"));
  app.on("window-all-closed", () => {});
  await app.whenReady();
  await mkdir(output, { recursive: true });
  const workspaceRoot = join(root, "workspace");
  await mkdir(workspaceRoot);
  const host = new KernelHostProcess(resolveHostLaunchConfig({ appPath: app.getAppPath() }));
  const unregister = registerProjectIpc(host);
  const window = new BrowserWindow({
    width: 1100, height: 760, title: "Navo F11.3 bridge acceptance",
    webPreferences: {
      preload: resolve("out/preload/index.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  const evidence: Record<string, unknown> = {};

  async function result<T>(method: keyof DesktopProjectApi, input: unknown): Promise<DesktopProjectResult<T>> {
    return window.webContents.executeJavaScript(`window.desktop.project.${method}(${JSON.stringify(input)})`);
  }

  async function call<T>(method: keyof DesktopProjectApi, input: unknown): Promise<T> {
    const response = await result<T>(method, input);
    assert.equal(response.type, "ok", JSON.stringify(response));
    return response.value;
  }

  async function paused(projectId: string): Promise<AutoRunSnapshotV1> {
    const deadline = Date.now() + 45_000;
    while (Date.now() < deadline) {
      const snapshot = await call<AutoRunSnapshotV1 | null>("autoRunGet", { projectId });
      if (snapshot?.status === "paused") return snapshot;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 25));
    }
    throw new Error("AutoRun did not pause within 45 seconds");
  }

  try {
    await host.start();
    await window.loadFile(resolve("out/renderer/index.html"));
    const project = await call<ProjectSummaryV1>("create", {
      name: "F11.3 desktop acceptance", goal: "Verify the desktop AutoRun contract", workspaceRoot,
    });
    const ref = { projectId: project.projectId };
    evidence.initial = await call("autoRunGet", ref);
    assert.equal(evidence.initial, null);
    evidence.invalidInput = await result("autoRunStart", { projectId: "" });
    assert.deepEqual(evidence.invalidInput, {
      type: "failed", failure: { code: "invalid-input", message: "The project request is invalid" },
    });
    const missing = await result("autoRunPause", ref);
    assert.ok(missing.type === "failed" && missing.failure.code === "auto-run-not-found");
    evidence.missing = missing;
    const unavailable = await result("autoRunStart", ref);
    assert.ok(unavailable.type === "failed" && unavailable.failure.code === "auto-run-unavailable");
    evidence.unavailable = unavailable;
    for await (const event of host.stream(projectTurnMethod, {
      ...ref, requestId: "f113-plan", target: { kind: "main" }, text: "Create the approved two-node plan",
    })) {
      if (event.type === "turn-failed") throw new Error(JSON.stringify(event));
    }
    const start = await call<AutoRunSnapshotV1>("autoRunStart", ref);
    assert.equal(start.status, "running");
    evidence.start = start;
    const notPaused = await result("autoRunResume", ref);
    assert.ok(notPaused.type === "failed" && notPaused.failure.code === "auto-run-not-paused");
    evidence.notPaused = notPaused;
    const pauseRequested = await call<AutoRunSnapshotV1>("autoRunPause", ref);
    assert.equal(pauseRequested.status, "running");
    assert.equal(pauseRequested.runId, start.runId);
    evidence.pauseRequested = pauseRequested;
    const failure = await paused(ref.projectId);
    assert.equal(failure.reason, "turn-failed");
    assert.equal(failure.currentTarget?.kind, "node");
    assert.equal(failure.nodeTurns, 1);
    evidence.failed = failure;
    const pause = await call<AutoRunSnapshotV1>("autoRunPause", ref);
    assert.deepEqual(pause, failure);
    evidence.pause = pause;
    const duplicate = await result("autoRunStart", ref);
    assert.ok(duplicate.type === "failed" && duplicate.failure.code === "auto-run-active");
    evidence.duplicate = duplicate;
    const resume = await call<AutoRunSnapshotV1>("autoRunResume", ref);
    assert.equal(resume.status, "running");
    assert.notEqual(resume.runId, start.runId);
    assert.equal(resume.nodeTurns, 0);
    evidence.resume = resume;
    evidence.resumedFailure = await paused(ref.projectId);
    const detail = await call<ProjectDetailV1>("get", ref);
    assert.equal(detail.roadmap?.nodes.length, 2);
    for (const node of detail.roadmap!.nodes) {
      const current = await call<ProjectDetailV1>("get", ref);
      const revision = current.roadmap!.nodes.find(value => value.nodeId === node.nodeId)!.revision;
      for await (const _ of host.stream(projectNodeReviewMethod, {
        ...ref, nodeId: node.nodeId, action: "skip" as const, reason: "QA fixture cleanup", reviewedRevision: revision,
      })) {}
    }
    const completed = await call<AutoRunSnapshotV1>("autoRunResume", ref);
    assert.equal(completed.status, "completed");
    assert.equal(completed.reason, "roadmap-complete");
    evidence.completed = completed;
    evidence.afterCompletion = await call("autoRunGet", ref);
    assert.equal(evidence.afterCompletion, null);
    evidence.runtime = { electron: process.versions.electron, node: process.versions.node };
    await writeFile(join(output, "result.json"), JSON.stringify(evidence, null, 2));
    process.stdout.write(`F11.3 Electron bridge acceptance PASSED: ${output}\n`);
  } catch (error) {
    await writeFile(join(output, "failure.json"), JSON.stringify({
      evidence, error: error instanceof Error ? error.stack : String(error),
    }, null, 2));
    throw error;
  } finally {
    unregister();
    window.destroy();
    await host.close();
    await rm(workspaceRoot, { recursive: true, force: true });
    await rm(join(root, "home"), { recursive: true, force: true });
  }
}

void main().then(() => app.exit(0), (error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});
