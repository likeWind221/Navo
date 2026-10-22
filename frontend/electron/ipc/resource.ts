import { BrowserWindow, dialog, ipcMain } from "electron";
import type { WebContents } from "electron";
import type { UserImportSourceV1 } from "../../../rpc/resource.js";
import type { DesktopResourceEvent, DesktopResourceResult } from "../../shared/resource.js";
import {
  RESOURCE_BROWSE_CHANNEL,
  RESOURCE_CANCEL_CHANNEL,
  RESOURCE_CHOOSE_DIRECTORY_CHANNEL,
  RESOURCE_CHOOSE_FILES_CHANNEL,
  RESOURCE_CHOOSE_REPLACEMENT_CHANNEL,
  RESOURCE_DELETE_CHANNEL,
  RESOURCE_EVENT_CHANNEL,
  RESOURCE_FOLDER_CREATE_CHANNEL,
  RESOURCE_FOLDER_DELETE_CHANNEL,
  RESOURCE_FOLDER_ORGANIZE_CHANNEL,
  RESOURCE_FOLLOW_START_CHANNEL,
  RESOURCE_IMPORT_START_CHANNEL,
  RESOURCE_REPLACE_CHANNEL,
  RESOURCE_UPDATE_CHANNEL,
} from "../../shared/resource/channels.js";
import { ResourceController } from "./resource/controller.js";

export interface ResourceDialogResult {
  readonly canceled: boolean;
  readonly filePaths: readonly string[];
}

export interface ResourceDialogs {
  files(sender: WebContents): Promise<ResourceDialogResult>;
  directory(sender: WebContents): Promise<ResourceDialogResult>;
  replacement(sender: WebContents): Promise<ResourceDialogResult>;
}

export function registerResourceIpc(controller: ResourceController, dialogs: ResourceDialogs = defaultDialogs): () => void {
  ipcMain.handle(RESOURCE_BROWSE_CHANNEL, (_event, candidate: unknown) => controller.browse(candidate));
  ipcMain.handle(RESOURCE_FOLDER_CREATE_CHANNEL, (_event, candidate: unknown) => controller.createFolder(candidate));
  ipcMain.handle(RESOURCE_FOLDER_ORGANIZE_CHANNEL, (_event, candidate: unknown) => controller.organizeFolder(candidate));
  ipcMain.handle(RESOURCE_FOLDER_DELETE_CHANNEL, (event, candidate: unknown) =>
    controller.deleteFolder(target(event.sender), candidate));
  ipcMain.handle(RESOURCE_UPDATE_CHANNEL, (_event, candidate: unknown) => controller.update(candidate));
  ipcMain.handle(RESOURCE_REPLACE_CHANNEL, (event, candidate: unknown) => controller.replace(target(event.sender), candidate));
  ipcMain.handle(RESOURCE_DELETE_CHANNEL, (_event, candidate: unknown) => controller.delete(candidate));
  ipcMain.handle(RESOURCE_IMPORT_START_CHANNEL, (event, candidate: unknown) => controller.startImport(target(event.sender), candidate));
  ipcMain.handle(RESOURCE_FOLLOW_START_CHANNEL, (event, candidate: unknown) => controller.startFollow(target(event.sender), candidate));
  ipcMain.handle(RESOURCE_CANCEL_CHANNEL, (event, candidate: unknown) => controller.cancel(event.sender.id, candidate));
  ipcMain.handle(RESOURCE_CHOOSE_FILES_CHANNEL, event => chooseSources(() => dialogs.files(event.sender), "file"));
  ipcMain.handle(RESOURCE_CHOOSE_DIRECTORY_CHANNEL, event => chooseSources(() => dialogs.directory(event.sender), "directory"));
  ipcMain.handle(RESOURCE_CHOOSE_REPLACEMENT_CHANNEL, event => chooseReplacement(() => dialogs.replacement(event.sender)));
  return () => {
    for (const channel of [RESOURCE_BROWSE_CHANNEL, RESOURCE_FOLDER_CREATE_CHANNEL, RESOURCE_FOLDER_ORGANIZE_CHANNEL,
      RESOURCE_FOLDER_DELETE_CHANNEL, RESOURCE_UPDATE_CHANNEL, RESOURCE_REPLACE_CHANNEL, RESOURCE_DELETE_CHANNEL,
      RESOURCE_IMPORT_START_CHANNEL, RESOURCE_FOLLOW_START_CHANNEL, RESOURCE_CANCEL_CHANNEL,
      RESOURCE_CHOOSE_FILES_CHANNEL, RESOURCE_CHOOSE_DIRECTORY_CHANNEL, RESOURCE_CHOOSE_REPLACEMENT_CHANNEL]) {
      ipcMain.removeHandler(channel);
    }
  };
}

function target(sender: WebContents) {
  return { ownerId: sender.id, isDestroyed: () => sender.isDestroyed(),
    send: (event: DesktopResourceEvent) => sender.send(RESOURCE_EVENT_CHANNEL, event) };
}

async function chooseSources(open: () => Promise<ResourceDialogResult>, kind: UserImportSourceV1["kind"]): Promise<DesktopResourceResult<readonly UserImportSourceV1[]>> {
  try {
    const result = await open();
    return { type: "ok", value: result.canceled ? [] : result.filePaths.map(path => ({ kind, path })) };
  } catch {
    return bridgeFailure("File selection failed");
  }
}

async function chooseReplacement(open: () => Promise<ResourceDialogResult>): Promise<DesktopResourceResult<string | null>> {
  try {
    const result = await open();
    return { type: "ok", value: result.canceled ? null : result.filePaths[0] ?? null };
  } catch {
    return bridgeFailure("Replacement selection failed");
  }
}

function bridgeFailure<T>(message: string): DesktopResourceResult<T> {
  return { type: "failed", failure: { code: "bridge-closed", message } };
}

async function open(sender: WebContents, properties: Array<"openFile" | "openDirectory" | "multiSelections">): Promise<ResourceDialogResult> {
  const window = BrowserWindow.fromWebContents(sender);
  if (window === null || window.isDestroyed()) return { canceled: true, filePaths: [] };
  return dialog.showOpenDialog(window, { title: "选择资料", properties });
}

const defaultDialogs: ResourceDialogs = {
  files: sender => open(sender, ["openFile", "multiSelections"]),
  directory: sender => open(sender, ["openDirectory"]),
  replacement: sender => open(sender, ["openFile"]),
};
