import {
  parseProjectAutoRunSnapshot,
  parseProjectAutoRunSnapshotOrNull,
  parseProjectDetail,
  parseProjectList,
  parseProjectSummary,
} from "../../../rpc/project/validation.js";
import type { DesktopBridgeFailureCode, DesktopProjectApi, DesktopProjectEventListener, DesktopProjectResult } from "../../shared/project.js";
import { parseDesktopProjectEvent, parseDesktopProjectHandle, parseDesktopProjectNull, parseDesktopProjectResult, parseWorkspaceChoice } from "../../shared/project/validation.js";
import {
  PROJECT_AUTORUN_GET_CHANNEL,
  PROJECT_AUTORUN_PAUSE_CHANNEL,
  PROJECT_AUTORUN_RESUME_CHANNEL,
  PROJECT_AUTORUN_START_CHANNEL,
  PROJECT_CHOOSE_WORKSPACE_CHANNEL,
  PROJECT_CREATE_CHANNEL,
  PROJECT_GET_CHANNEL,
  PROJECT_LIST_CHANNEL,
  PROJECT_TURN_START_CHANNEL, PROJECT_TURN_CANCEL_CHANNEL,
  PROJECT_FOLLOW_START_CHANNEL, PROJECT_EVENT_CHANNEL,
} from "../../shared/project/channels.js";

export interface ProjectIpcRenderer {
  invoke(channel: string, value: unknown): Promise<unknown>;
  on(channel: string, listener: (event: unknown, value: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, value: unknown) => void): void;
}

export function createDesktopProjectApi(
  ipc: ProjectIpcRenderer,
  reportInvalidUpdate: () => void = () => console.error("[preload] dropped invalid Project event"),
): DesktopProjectApi {
  async function request<T>(channel: string, input: unknown, parse: (value: unknown) => T) {
    let raw: unknown;
    try {
      raw = await ipc.invoke(channel, input);
    } catch {
      return failed<T>("bridge-closed", "Project bridge is closed");
    }
    try {
      return parseDesktopProjectResult(raw, parse);
    } catch {
      return failed<T>("invalid-output", "Project bridge returned a malformed result");
    }
  }

  return Object.freeze({
    list: () => request(PROJECT_LIST_CHANNEL, {}, parseProjectList),
    create: input => request(PROJECT_CREATE_CHANNEL, input, parseProjectSummary),
    get: input => request(PROJECT_GET_CHANNEL, input, parseProjectDetail),
    autoRunStart: input => request(PROJECT_AUTORUN_START_CHANNEL, input, parseProjectAutoRunSnapshot),
    autoRunPause: input => request(PROJECT_AUTORUN_PAUSE_CHANNEL, input, parseProjectAutoRunSnapshot),
    autoRunResume: input => request(PROJECT_AUTORUN_RESUME_CHANNEL, input, parseProjectAutoRunSnapshot),
    autoRunGet: input => request(PROJECT_AUTORUN_GET_CHANNEL, input, parseProjectAutoRunSnapshotOrNull),
    chooseWorkspace: () => request(PROJECT_CHOOSE_WORKSPACE_CHANNEL, null, parseWorkspaceChoice),
    startTurn: input => request(PROJECT_TURN_START_CHANNEL, input, parseDesktopProjectHandle),
    cancel: operationId => request(PROJECT_TURN_CANCEL_CHANNEL, operationId, parseDesktopProjectNull),
    startFollow: input => request(PROJECT_FOLLOW_START_CHANNEL, input, parseDesktopProjectHandle),
    onEvent(listener: DesktopProjectEventListener): () => void {
      const receive = (_event: unknown, candidate: unknown): void => {
        try { listener(parseDesktopProjectEvent(candidate)); } catch { reportInvalidUpdate(); }
      };
      ipc.on(PROJECT_EVENT_CHANNEL, receive);
      return () => ipc.removeListener(PROJECT_EVENT_CHANNEL, receive);
    },
  } satisfies DesktopProjectApi);
}

function failed<T>(code: DesktopBridgeFailureCode, message: string): DesktopProjectResult<T> {
  return { type: "failed", failure: { code, message } };
}
