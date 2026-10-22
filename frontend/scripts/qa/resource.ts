import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { app, BrowserWindow } from "electron";
import { resolveHostLaunchConfig } from "../../electron/host/launch.js";
import { KernelHostProcess } from "../../electron/host/process.js";
import { registerProjectIpc } from "../../electron/ipc/project.js";
import { registerResourceIpc } from "../../electron/ipc/resource.js";
import { ResourceController } from "../../electron/ipc/resource/controller.js";
import type { DesktopResourceEvent, DesktopResourceResult } from "../../shared/resource.js";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "navo-f132b-desktop-"));
  const workspace = join(root, "workspace");
  const selected = join(root, "selected");
  const output = resolve(process.env.NAVO_QA_OUTPUT ?? join(tmpdir(), `navo-f132b-evidence-${Date.now()}`));
  await mkdir(workspace);
  await mkdir(selected);
  const first = join(selected, "first.md");
  const second = join(selected, "second.txt");
  const replacement = join(selected, "replacement.md");
  await writeFile(first, "# first\n");
  await writeFile(second, "second\n");
  await writeFile(replacement, "# replacement\n");
  process.env.NAVO_HOST_MODE = "mock";
  process.env.NAVO_REPO_ROOT = resolve("..");
  process.env.NAVO_HOME = join(root, "home");
  app.setPath("userData", join(root, "electron"));
  app.on("window-all-closed", () => {});
  await app.whenReady();
  await mkdir(output, { recursive: true });

  const host = new KernelHostProcess(resolveHostLaunchConfig({ appPath: app.getAppPath() }));
  const resources = new ResourceController(host);
  const unregisterProject = registerProjectIpc(host);
  const unregisterResource = registerResourceIpc(resources);
  const window = new BrowserWindow({ show: false, webPreferences: {
    preload: resolve("out/preload/index.js"), contextIsolation: true, nodeIntegration: false, sandbox: true,
  } });
  const ownerId = window.webContents.id;
  window.webContents.once("destroyed", () => resources.cancelOwner(ownerId));
  const evidence: Record<string, unknown> = {};

  async function result<T>(scope: "project" | "resource", method: string, input?: unknown): Promise<DesktopResourceResult<T>> {
    return window.webContents.executeJavaScript(
      `window.desktop.${scope}.${method}(${input === undefined ? "" : JSON.stringify(input)})`,
    );
  }

  async function call<T>(method: string, input?: unknown): Promise<T> {
    const response = await result<T>("resource", method, input);
    assert.equal(response.type, "ok", JSON.stringify(response));
    return response.value;
  }

  async function events(): Promise<DesktopResourceEvent[]> {
    return window.webContents.executeJavaScript("window.__resourceEvents");
  }

  async function waitFor(predicate: (events: DesktopResourceEvent[]) => boolean, label: string): Promise<DesktopResourceEvent[]> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const current = await events();
      if (predicate(current)) return current;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 20));
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  try {
    await host.start();
    await window.loadFile(resolve("out/renderer/index.html"));
    await window.webContents.executeJavaScript(`
      window.__resourceEvents = [];
      window.__resourceUnsubscribe = window.desktop.resource.onEvent(event => window.__resourceEvents.push(event));
      true;
    `);
    const created = await result<{ projectId: string }>("project", "create", {
      name: "F13.2b acceptance", goal: null, workspaceRoot: workspace,
    });
    assert.equal(created.type, "ok", JSON.stringify(created));
    if (created.type !== "ok") return;
    const projectId = created.value.projectId;
    evidence.invalidInput = await result("resource", "browse", { projectId: "", path: null });
    assert.deepEqual(evidence.invalidInput, { type: "failed",
      failure: { code: "invalid-input", message: "The resource request is invalid" } });

    await call("createFolder", { projectId, path: "papers" });
    const follow = await call<{ subscriptionId: string }>("startFollow", { projectId, path: null });
    await waitFor(all => all.some(event => event.type === "library-snapshot"
      && event.subscriptionId === follow.subscriptionId), "library baseline");

    const imported = await call<{ subscriptionId: string }>("startImport", { projectId, requestId: "qa_import_1",
      sources: [{ kind: "file", path: first }] });
    let current = await waitFor(all => all.some(event => event.type === "stream-complete"
      && event.subscriptionId === imported.subscriptionId && event.status === "completed"), "import completion");
    const saved = current.find(event => event.type === "import-item"
      && event.subscriptionId === imported.subscriptionId && event.item.status === "saved");
    assert.ok(saved?.type === "import-item" && saved.item.status === "saved");
    if (saved?.type !== "import-item" || saved.item.status !== "saved") throw new Error("First import did not save a Resource");
    const resourceId = saved.item.resourceId;
    let library = await call<any>("browse", { projectId, path: null });
    const original = library.resources.find((resource: any) => resource.resourceId === resourceId);
    const updated = await call<any>("update", { projectId, resourceId, expectedRevision: original.revision,
      name: "renamed.md", folder: "papers", description: "Bridge acceptance" });
    assert.equal(updated.libraryPath, "papers/renamed.md");
    assert.equal(updated.description, "Bridge acceptance");

    await call("organizeFolder", { projectId, path: "papers", targetPath: "archive" });
    library = await call<any>("browse", { projectId, path: "archive" });
    const moved = library.resources[0];
    const replaced = await call<any>("replace", { projectId, resourceId, expectedRevision: moved.revision,
      operationId: "qa_replace", sourcePath: replacement });
    assert.equal(replaced.assetGeneration, 2);
    const confirmation = await call<any>("deleteFolder", { projectId, path: "archive", recursive: false,
      operationId: "qa_folder_check" });
    assert.equal(confirmation.status, "confirmation-required");
    const deletedFolder = await call<any>("deleteFolder", { projectId, path: "archive", recursive: true,
      operationId: "qa_folder_delete" });
    assert.equal(deletedFolder.status, "deleted");

    const secondImport = await call<{ subscriptionId: string }>("startImport", { projectId, requestId: "qa_import_2",
      sources: [{ kind: "file", path: second }] });
    current = await waitFor(all => all.some(event => event.type === "stream-complete"
      && event.subscriptionId === secondImport.subscriptionId), "second import completion");
    const secondSaved = current.find(event => event.type === "import-item"
      && event.subscriptionId === secondImport.subscriptionId && event.item.status === "saved");
    assert.ok(secondSaved?.type === "import-item" && secondSaved.item.status === "saved");
    if (secondSaved?.type !== "import-item" || secondSaved.item.status !== "saved") throw new Error("Second import did not save a Resource");
    const secondResourceId = secondSaved.item.resourceId;
    library = await call<any>("browse", { projectId, path: null });
    const secondResource = library.resources.find((resource: any) => resource.resourceId === secondResourceId);
    assert.deepEqual(await call("delete", { projectId, resourceId: secondResource.resourceId,
      expectedRevision: secondResource.revision, operationId: "qa_delete" }),
    { resourceId: secondResource.resourceId, deleted: true });

    const cancelled = await call<{ subscriptionId: string }>("startImport", { projectId, requestId: "qa_cancel",
      sources: Array.from({ length: 32 }, () => ({ kind: "file", path: first })) });
    await call("cancel", cancelled.subscriptionId);
    await waitFor(all => all.some(event => event.type === "stream-complete"
      && event.subscriptionId === cancelled.subscriptionId && event.status === "cancelled"), "cancelled import");
    await call("cancel", follow.subscriptionId);
    const cleanupFollow = await call<{ subscriptionId: string }>("startFollow", { projectId, path: null });
    Object.assign(evidence, {
      projectId,
      firstImport: imported.subscriptionId,
      resourceId,
      replacedGeneration: replaced.assetGeneration,
      folderDeletion: deletedFolder,
      cancelledImport: cancelled.subscriptionId,
      cleanupFollow: cleanupFollow.subscriptionId,
      events: await events(),
      runtime: { electron: process.versions.electron, node: process.versions.node },
    });
    await writeFile(join(output, "result.json"), JSON.stringify(evidence, null, 2));
    await window.webContents.executeJavaScript("window.__resourceUnsubscribe(); true;");
    window.destroy();
    process.stdout.write(`F13.2b Electron bridge acceptance PASSED: ${output}\n`);
  } catch (error) {
    await writeFile(join(output, "failure.json"), JSON.stringify({ evidence,
      error: error instanceof Error ? error.stack : String(error) }, null, 2));
    throw error;
  } finally {
    unregisterResource();
    unregisterProject();
    resources.dispose();
    if (!window.isDestroyed()) window.destroy();
    await host.close();
    await rm(join(root, "home"), { recursive: true, force: true });
    await rm(workspace, { recursive: true, force: true });
    await rm(selected, { recursive: true, force: true });
    process.stdout.write(`Electron userData retained at ${join(root, "electron")}\n`);
  }
}

void main().then(() => app.exit(0), (error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});
