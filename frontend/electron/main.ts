import { join } from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { KernelHostProcess } from "./host/kernel-host-process.js";
import { resolveHostLaunchConfig } from "./host/launch-config.js";
import { AgentTurnController } from "./ipc/agent-turn-controller.js";
import { registerAgentTurnIpc } from "./ipc/agent-turn-ipc.js";

const hasSingleInstanceLock = app.requestSingleInstanceLock();
let quittingAfterCleanup = false;
let kernelHost: KernelHostProcess | undefined;
let agentTurns: AgentTurnController | undefined;
let unregisterAgentTurnIpc: (() => void) | undefined;

function createWindow(): void {
  const window = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 960,
    minHeight: 640,
    show: false,
    backgroundColor: "#f4f1ea",
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  window.on("ready-to-show", () => window.show());
  window.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url);
    return { action: "deny" };
  });
  const ownerId = window.webContents.id;
  window.webContents.once("destroyed", () => agentTurns?.cancelOwner(ownerId));

  const rendererUrl = process.env.ELECTRON_RENDERER_URL;
  if (rendererUrl !== undefined) {
    void window.loadURL(rendererUrl);
  } else {
    void window.loadFile(join(__dirname, "../renderer/index.html"));
  }
}

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const window = BrowserWindow.getAllWindows()[0];
    if (window === undefined) return;
    if (window.isMinimized()) window.restore();
    window.focus();
  });

  app.whenReady().then(() => {
    kernelHost = new KernelHostProcess(resolveHostLaunchConfig({ appPath: app.getAppPath() }));
    agentTurns = new AgentTurnController(kernelHost);
    unregisterAgentTurnIpc = registerAgentTurnIpc(agentTurns);
    void kernelHost.start().catch((error: unknown) => {
      const message = error instanceof Error ? error.message : "Unknown Kernel Host startup failure";
      console.error(`[electron-main] ${message}`);
    });
    createWindow();
    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on("before-quit", (event) => {
    if (quittingAfterCleanup || kernelHost === undefined) return;
    event.preventDefault();
    quittingAfterCleanup = true;
    unregisterAgentTurnIpc?.();
    agentTurns?.dispose();
    void kernelHost.close().finally(() => app.quit());
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
