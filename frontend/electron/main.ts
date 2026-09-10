import { join } from "node:path";
import { app, BrowserWindow, shell } from "electron";
import { externalHref } from "../shared/link.js";
import { KernelHostProcess } from "./host/process.js";
import { resolveHostLaunchConfig } from "./host/launch.js";
import { AgentCommandController } from "./ipc/command/controller.js";
import { AgentTurnV2Controller } from "./ipc/agent/v2.js";
import { cancelAgentSessionOwner, registerAgentSessionIpc } from "./ipc/session.js";

const hasSingleInstanceLock = app.requestSingleInstanceLock();
let quittingAfterCleanup = false;
let kernelHost: KernelHostProcess | undefined;
let agentTurns: AgentTurnV2Controller | undefined;
let agentCommands: AgentCommandController | undefined;
let unregisterAgentSessionIpc: (() => void) | undefined;

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
    const href = externalHref(url);
    if (href !== null) void shell.openExternal(href).catch((error: unknown) => console.error("[external-link]", error));
    return { action: "deny" };
  });
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  const ownerId = window.webContents.id;
  window.webContents.once("destroyed", () => {
    if (agentTurns !== undefined && agentCommands !== undefined) {
      cancelAgentSessionOwner(agentTurns, agentCommands, ownerId);
    }
  });

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
    agentTurns = new AgentTurnV2Controller(kernelHost);
    agentCommands = new AgentCommandController(kernelHost);
    unregisterAgentSessionIpc = registerAgentSessionIpc(agentTurns, agentCommands);
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
    unregisterAgentSessionIpc?.();
    agentTurns?.dispose();
    agentCommands?.dispose();
    void kernelHost.close().finally(() => app.quit());
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
