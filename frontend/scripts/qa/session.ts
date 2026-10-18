import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { app, BrowserWindow } from "electron";
import { sessionCommandMethod } from "../../../rpc/command.js";
import { agentTurnV2Method } from "../../../rpc/content/stream.js";
import type {
  SessionContextSnapshotV1,
  SessionHistoryV1,
} from "../../../rpc/session.js";
import { resolveHostLaunchConfig } from "../../electron/host/launch.js";
import { KernelHostProcess } from "../../electron/host/process.js";
import { registerProjectIpc } from "../../electron/ipc/project.js";
import { registerSessionContextIpc, SessionContextController } from "../../electron/ipc/session-context.js";
import type {
  DesktopSessionApi,
  DesktopSessionEvent,
  DesktopSessionResult,
} from "../../shared/session.js";

async function main(): Promise<void> {
  const root = await mkdtemp(join(tmpdir(), "navo-f126-desktop-"));
  const output = resolve(process.env.NAVO_QA_OUTPUT ?? join(tmpdir(), `navo-f126-evidence-${Date.now()}`));
  process.env.NAVO_HOST_MODE = "mock";
  process.env.NAVO_MOCK_LLM_MODE = "session-context";
  process.env.NAVO_REPO_ROOT = resolve("..");
  process.env.NAVO_HOME = join(root, "home");
  app.setPath("userData", join(root, "electron"));
  app.on("window-all-closed", () => {});
  await app.whenReady();
  await mkdir(output, { recursive: true });

  const host = new KernelHostProcess(resolveHostLaunchConfig({ appPath: app.getAppPath() }));
  const controller = new SessionContextController(host);
  const unregisterSession = registerSessionContextIpc(controller);
  const unregisterProject = registerProjectIpc(host);
  const window = new BrowserWindow({
    width: 1000, height: 720, title: "Navo F12.6 bridge acceptance",
    webPreferences: {
      preload: resolve("out/preload/index.js"),
      contextIsolation: true, nodeIntegration: false, sandbox: true,
    },
  });
  const evidence: Record<string, unknown> = {};
  const sessionId = "qa-session";
  const otherId = "qa-session-other";

  async function result<T>(method: keyof DesktopSessionApi, input: unknown): Promise<DesktopSessionResult<T>> {
    return window.webContents.executeJavaScript(
      `window.desktop.session.${method}(${JSON.stringify(input)})`,
    );
  }

  async function call<T>(method: keyof DesktopSessionApi, input: unknown): Promise<T> {
    const response = await result<T>(method, input);
    assert.equal(response.type, "ok", JSON.stringify(response));
    return response.value;
  }

  async function readEvents(): Promise<DesktopSessionEvent[]> {
    return window.webContents.executeJavaScript("window.__sessionEvents");
  }

  async function waitFor(
    predicate: (events: DesktopSessionEvent[]) => boolean,
    label: string,
  ): Promise<DesktopSessionEvent[]> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
      const events = await readEvents();
      if (predicate(events)) return events;
      await new Promise(resolveDelay => setTimeout(resolveDelay, 20));
    }
    throw new Error(`Timed out waiting for ${label}`);
  }

  async function turn(text: string, requestId: string): Promise<void> {
    for await (const event of host.stream(agentTurnV2Method, { sessionId, requestId, text })) {
      if (event.type === "turn-failed") throw new Error(JSON.stringify(event.failure));
    }
  }

  try {
    await host.start();
    await window.loadFile(resolve("out/renderer/index.html"));
    await window.webContents.executeJavaScript(`
      window.__sessionEvents = [];
      window.__sessionUnsubscribe = window.desktop.session.onContextEvent(event => window.__sessionEvents.push(event));
      true;
    `);

    for (let index = 0; index < 8; index += 1) {
      await turn("seed ".padEnd(1_500, "s"), `f126-seed-${index}`);
    }
    evidence.invalidInput = await result("getContext", { sessionId: "" });
    assert.deepEqual(evidence.invalidInput, {
      type: "failed", failure: { code: "invalid-input", message: "The session request is invalid" },
    });

    const snapshot = await call<SessionContextSnapshotV1>("getContext", { sessionId });
    assert.equal(snapshot.sessionId, sessionId);
    assert.ok(snapshot.eventSequence >= 16);
    assert.equal(snapshot.surfaceGeneration, 0);
    assert.equal(snapshot.budget.kind, "enabled");
    if (snapshot.budget.kind === "enabled") {
      assert.equal(snapshot.budget.thresholdTokens, 8_000);
    }
    evidence.snapshot = snapshot;

    const firstPage = await call<SessionHistoryV1>("getHistory", { sessionId, limit: 3 });
    assert.equal(firstPage.surfaceGeneration, 0);
    assert.equal(firstPage.entries.length, 3);
    assert.deepEqual(firstPage.nextCursor, { surfaceGeneration: 0, offset: 3 });
    const secondPage = await call<SessionHistoryV1>("getHistory", {
      sessionId, limit: 3, cursor: firstPage.nextCursor!,
    });
    assert.ok(secondPage.entries[0]!.sequence > firstPage.entries[2]!.sequence);
    evidence.firstPage = firstPage;
    evidence.secondPage = secondPage;

    const follow = await call<{ readonly subscriptionId: string }>("startContextFollow", { sessionId });
    const otherFollow = await call<{ readonly subscriptionId: string }>(
      "startContextFollow", { sessionId: otherId },
    );
    let events = await waitFor(all =>
      all.some(event => event.type === "context-event"
        && event.subscriptionId === follow.subscriptionId
        && event.event.type === "snapshot"
        && event.event.snapshot.eventSequence === snapshot.eventSequence)
      && all.some(event => event.type === "context-event"
        && event.subscriptionId === otherFollow.subscriptionId
        && event.event.type === "snapshot"), "initial snapshots");
    evidence.initialEvents = events;

    await turn("follow update ".padEnd(1_500, "u"), "f126-update");
    events = await waitFor(all => all.some(event =>
      event.type === "context-event"
      && event.subscriptionId === follow.subscriptionId
      && event.event.type === "context-updated"
      && event.event.snapshot.eventSequence > snapshot.eventSequence), "ordered context update");
    const otherEvents = events.filter(event => event.subscriptionId === otherFollow.subscriptionId);
    assert.equal(otherEvents.length, 1);
    evidence.updatedEvents = events;

    for await (const event of host.stream(sessionCommandMethod, {
      sessionId, commandId: "f126-compact", name: "compact", args: "",
    })) {
      if (event.type === "command-failed") throw new Error(JSON.stringify(event.failure));
    }
    events = await waitFor(all => all.some(event =>
      event.type === "context-event"
      && event.subscriptionId === follow.subscriptionId
      && event.event.type === "compaction-event"
      && event.event.event.kind === "ended"), "compaction ended");
    const compaction = events.flatMap(event =>
      event.type === "context-event"
      && event.subscriptionId === follow.subscriptionId
      && event.event.type === "compaction-event"
        ? [event.event.event] : []);
    assert.deepEqual(compaction.map(event => event.kind), ["started", "checkpoint", "ended"]);
    assert.equal(compaction[2]?.kind === "ended" ? compaction[2].status : "", "completed");
    evidence.compaction = compaction;

    const stale = await result<SessionHistoryV1>("getHistory", {
      sessionId, limit: 3, cursor: firstPage.nextCursor!,
    });
    assert.equal(stale.type, "failed");
    if (stale.type === "failed") {
      assert.equal(stale.failure.code, "history-changed");
      assert.deepEqual(stale.failure.details, { surfaceGeneration: 1 });
    }
    evidence.staleCursor = stale;

    const compactedHistory = await call<SessionHistoryV1>("getHistory", { sessionId, limit: 50 });
    assert.equal(compactedHistory.surfaceGeneration, 1);
    assert.equal(compactedHistory.entries[0]?.kind, "summary-checkpoint");
    evidence.compactedHistory = compactedHistory;

    const after = await call<SessionContextSnapshotV1>("getContext", { sessionId });
    assert.equal(after.surfaceGeneration, 1);
    assert.ok(after.measurement.usedTokens < snapshot.measurement.usedTokens);
    evidence.snapshotAfter = after;

    assert.deepEqual(await call("cancelContextFollow", follow.subscriptionId), null);
    const beforeCancel = (await readEvents()).filter(event =>
      event.subscriptionId === follow.subscriptionId).length;
    await turn("after cancel ".padEnd(1_500, "c"), "f126-after-cancel");
    await new Promise(resolveDelay => setTimeout(resolveDelay, 200));
    const afterCancel = (await readEvents()).filter(event =>
      event.subscriptionId === follow.subscriptionId).length;
    assert.equal(afterCancel, beforeCancel);
    evidence.cancel = { beforeCancel, afterCancel };

    assert.deepEqual(await call("cancelContextFollow", otherFollow.subscriptionId), null);
    await window.webContents.executeJavaScript("window.__sessionUnsubscribe(); true;");
    evidence.runtime = {
      electron: process.versions.electron,
      node: process.versions.node,
      sessionId,
      otherId,
    };
    await writeFile(join(output, "result.json"), JSON.stringify(evidence, null, 2));
    process.stdout.write(`F12.6 Electron bridge acceptance PASSED: ${output}\n`);
  } catch (error) {
    await writeFile(join(output, "failure.json"), JSON.stringify({
      evidence,
      error: error instanceof Error ? error.stack : String(error),
    }, null, 2));
    throw error;
  } finally {
    unregisterSession();
    unregisterProject();
    controller.dispose();
    window.destroy();
    await host.close();
    await rm(join(root, "home"), { recursive: true, force: true });
    process.stdout.write(`Electron userData retained at ${join(root, "electron")}\n`);
  }
}

void main().then(() => app.exit(0), (error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.stack : String(error)}\n`);
  app.exit(1);
});
