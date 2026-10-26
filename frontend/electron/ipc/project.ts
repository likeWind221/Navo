import { BrowserWindow, dialog, ipcMain } from "electron";
import type { WebContents } from "electron";

import {
  PROJECT_AUTORUN_GET_CHANNEL,
  PROJECT_AUTORUN_PAUSE_CHANNEL,
  PROJECT_AUTORUN_RESUME_CHANNEL,
  PROJECT_AUTORUN_START_CHANNEL,
  PROJECT_CHOOSE_WORKSPACE_CHANNEL,
  PROJECT_CREATE_CHANNEL,
  PROJECT_GET_CHANNEL,
  PROJECT_LIST_CHANNEL,
  PROJECT_TURN_START_CHANNEL,
  PROJECT_TURN_CANCEL_CHANNEL,
  PROJECT_FOLLOW_START_CHANNEL,
  PROJECT_FOLLOW_CANCEL_CHANNEL,
  PROJECT_EVENT_CHANNEL,
} from "../../shared/project/channels.js";
import { chooseWorkspace, createProjectHandlers } from "./project/handler.js";
import type { DirectoryDialogResult, ProjectHost } from "./project/handler.js";
import { ProjectController } from "./project/controller.js";

export function registerProjectIpc(
  host: ProjectHost,
  openDialog: (sender: WebContents) => Promise<DirectoryDialogResult> = openDirectoryDialog,
  controller: ProjectController = new ProjectController(host),
): () => void {
  const handlers = createProjectHandlers(host);
  ipcMain.handle(PROJECT_LIST_CHANNEL, (_event, candidate: unknown) => handlers.list(candidate));
  ipcMain.handle(PROJECT_CREATE_CHANNEL, (_event, candidate: unknown) => handlers.create(candidate));
  ipcMain.handle(PROJECT_GET_CHANNEL, (_event, candidate: unknown) => handlers.get(candidate));
  ipcMain.handle(PROJECT_AUTORUN_START_CHANNEL, (_event, candidate: unknown) => handlers.autoRunStart(candidate));
  ipcMain.handle(PROJECT_AUTORUN_PAUSE_CHANNEL, (_event, candidate: unknown) => handlers.autoRunPause(candidate));
  ipcMain.handle(PROJECT_AUTORUN_RESUME_CHANNEL, (_event, candidate: unknown) => handlers.autoRunResume(candidate));
  ipcMain.handle(PROJECT_AUTORUN_GET_CHANNEL, (_event, candidate: unknown) => handlers.autoRunGet(candidate));
  ipcMain.handle(PROJECT_CHOOSE_WORKSPACE_CHANNEL, event => chooseWorkspace(() => openDialog(event.sender)));
  ipcMain.handle(PROJECT_TURN_START_CHANNEL, (event, candidate: unknown) => controller.startTurn(target(event.sender), candidate));
  ipcMain.handle(PROJECT_TURN_CANCEL_CHANNEL, (event, candidate: unknown) => controller.cancel(event.sender.id, String(candidate)));
  ipcMain.handle(PROJECT_FOLLOW_START_CHANNEL, (event, candidate: unknown) => controller.startFollow(target(event.sender), candidate));
  ipcMain.handle(PROJECT_FOLLOW_CANCEL_CHANNEL, (event, candidate: unknown) => controller.cancel(event.sender.id, String(candidate)));
  return () => {
    ipcMain.removeHandler(PROJECT_LIST_CHANNEL);
    ipcMain.removeHandler(PROJECT_CREATE_CHANNEL);
    ipcMain.removeHandler(PROJECT_GET_CHANNEL);
    ipcMain.removeHandler(PROJECT_AUTORUN_START_CHANNEL);
    ipcMain.removeHandler(PROJECT_AUTORUN_PAUSE_CHANNEL);
    ipcMain.removeHandler(PROJECT_AUTORUN_RESUME_CHANNEL);
    ipcMain.removeHandler(PROJECT_AUTORUN_GET_CHANNEL);
    ipcMain.removeHandler(PROJECT_CHOOSE_WORKSPACE_CHANNEL);
    ipcMain.removeHandler(PROJECT_TURN_START_CHANNEL);
    ipcMain.removeHandler(PROJECT_TURN_CANCEL_CHANNEL);
    ipcMain.removeHandler(PROJECT_FOLLOW_START_CHANNEL);
    ipcMain.removeHandler(PROJECT_FOLLOW_CANCEL_CHANNEL);
  };
}

function target(sender: WebContents) {
  return { ownerId: sender.id, isDestroyed: () => sender.isDestroyed(), send: (event: import("../../shared/project.js").DesktopProjectEvent) => sender.send(PROJECT_EVENT_CHANNEL, event) };
}

async function openDirectoryDialog(sender: WebContents): Promise<DirectoryDialogResult> {
  const window = BrowserWindow.fromWebContents(sender);
  if (window === null || window.isDestroyed()) return { canceled: true, filePaths: [] };
  return dialog.showOpenDialog(window, {
    title: "选择项目工作目录",
    properties: ["openDirectory", "createDirectory"],
  });
}
