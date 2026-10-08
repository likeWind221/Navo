import { BrowserWindow, dialog, ipcMain } from "electron";
import type { WebContents } from "electron";

import {
  PROJECT_CHOOSE_WORKSPACE_CHANNEL,
  PROJECT_CREATE_CHANNEL,
  PROJECT_GET_CHANNEL,
  PROJECT_LIST_CHANNEL,
} from "../../shared/project/channels.js";
import { chooseWorkspace, createProjectHandlers } from "./project/handler.js";
import type { DirectoryDialogResult, ProjectHost } from "./project/handler.js";

export function registerProjectIpc(
  host: ProjectHost,
  openDialog: (sender: WebContents) => Promise<DirectoryDialogResult> = openDirectoryDialog,
): () => void {
  const handlers = createProjectHandlers(host);
  ipcMain.handle(PROJECT_LIST_CHANNEL, (_event, candidate: unknown) => handlers.list(candidate));
  ipcMain.handle(PROJECT_CREATE_CHANNEL, (_event, candidate: unknown) => handlers.create(candidate));
  ipcMain.handle(PROJECT_GET_CHANNEL, (_event, candidate: unknown) => handlers.get(candidate));
  ipcMain.handle(PROJECT_CHOOSE_WORKSPACE_CHANNEL, event => chooseWorkspace(() => openDialog(event.sender)));
  return () => {
    ipcMain.removeHandler(PROJECT_LIST_CHANNEL);
    ipcMain.removeHandler(PROJECT_CREATE_CHANNEL);
    ipcMain.removeHandler(PROJECT_GET_CHANNEL);
    ipcMain.removeHandler(PROJECT_CHOOSE_WORKSPACE_CHANNEL);
  };
}

async function openDirectoryDialog(sender: WebContents): Promise<DirectoryDialogResult> {
  const window = BrowserWindow.fromWebContents(sender);
  if (window === null || window.isDestroyed()) return { canceled: true, filePaths: [] };
  return dialog.showOpenDialog(window, {
    title: "选择项目工作目录",
    properties: ["openDirectory", "createDirectory"],
  });
}
