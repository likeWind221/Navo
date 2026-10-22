import {
  parseFolderDeleteResult,
  parseLibraryDirectory,
  parseLibraryItem,
  parseLibrarySnapshot,
  parseResourceDeleteResult,
} from "../../../rpc/resource/validation.js";
import type { DesktopResourceApi, DesktopResourceEventListener, DesktopResourceResult } from "../../shared/resource.js";
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
import {
  parseDesktopReplacementPath,
  parseDesktopResourceEvent,
  parseDesktopResourceHandle,
  parseDesktopResourceNull,
  parseDesktopResourceResult,
  parseDesktopResourceSources,
} from "../../shared/resource/validation.js";

export interface ResourceIpcRenderer {
  invoke(channel: string, value?: unknown): Promise<unknown>;
  on(channel: string, listener: (event: unknown, value: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, value: unknown) => void): void;
}

export function createDesktopResourceApi(
  ipc: ResourceIpcRenderer,
  reportInvalidEvent: () => void = () => console.error("[preload] dropped invalid Resource event"),
): DesktopResourceApi {
  async function request<T>(channel: string, input: unknown, parse: (value: unknown) => T): Promise<DesktopResourceResult<T>> {
    let raw: unknown;
    try {
      raw = await ipc.invoke(channel, input);
    } catch {
      return failed("bridge-closed", "Resource bridge is closed");
    }
    try {
      return parseDesktopResourceResult(raw, parse);
    } catch {
      return failed("invalid-output", "Resource bridge returned a malformed result");
    }
  }

  return Object.freeze({
    browse: input => request(RESOURCE_BROWSE_CHANNEL, input, parseLibrarySnapshot),
    createFolder: input => request(RESOURCE_FOLDER_CREATE_CHANNEL, input, parseLibraryDirectory),
    organizeFolder: input => request(RESOURCE_FOLDER_ORGANIZE_CHANNEL, input, parseLibraryDirectory),
    deleteFolder: input => request(RESOURCE_FOLDER_DELETE_CHANNEL, input, parseFolderDeleteResult),
    update: input => request(RESOURCE_UPDATE_CHANNEL, input, parseLibraryItem),
    replace: input => request(RESOURCE_REPLACE_CHANNEL, input, parseLibraryItem),
    delete: input => request(RESOURCE_DELETE_CHANNEL, input, parseResourceDeleteResult),
    startImport: input => request(RESOURCE_IMPORT_START_CHANNEL, input, parseDesktopResourceHandle),
    startFollow: input => request(RESOURCE_FOLLOW_START_CHANNEL, input, parseDesktopResourceHandle),
    cancel: operationId => request(RESOURCE_CANCEL_CHANNEL, operationId, parseDesktopResourceNull),
    chooseFiles: () => request(RESOURCE_CHOOSE_FILES_CHANNEL, null, parseDesktopResourceSources),
    chooseDirectory: () => request(RESOURCE_CHOOSE_DIRECTORY_CHANNEL, null, parseDesktopResourceSources),
    chooseReplacement: () => request(RESOURCE_CHOOSE_REPLACEMENT_CHANNEL, null, parseDesktopReplacementPath),
    onEvent(listener: DesktopResourceEventListener): () => void {
      const receive = (_event: unknown, candidate: unknown): void => {
        try {
          listener(parseDesktopResourceEvent(candidate));
        } catch {
          reportInvalidEvent();
        }
      };
      ipc.on(RESOURCE_EVENT_CHANNEL, receive);
      return () => ipc.removeListener(RESOURCE_EVENT_CHANNEL, receive);
    },
  } satisfies DesktopResourceApi);
}

function failed<T>(code: "invalid-output" | "bridge-closed", message: string): DesktopResourceResult<T> {
  return { type: "failed", failure: { code, message } };
}
