import { parseProjectDetail, parseProjectList, parseProjectSummary } from "../../../rpc/project/validation.js";
import type { DesktopBridgeFailureCode, DesktopProjectApi, DesktopProjectResult } from "../../shared/project.js";
import { parseDesktopProjectResult, parseWorkspaceChoice } from "../../shared/project/validation.js";
import {
  PROJECT_CHOOSE_WORKSPACE_CHANNEL,
  PROJECT_CREATE_CHANNEL,
  PROJECT_GET_CHANNEL,
  PROJECT_LIST_CHANNEL,
} from "../../shared/project/channels.js";

export interface ProjectIpcRenderer {
  invoke(channel: string, value: unknown): Promise<unknown>;
}

export function createDesktopProjectApi(ipc: ProjectIpcRenderer): DesktopProjectApi {
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
    chooseWorkspace: () => request(PROJECT_CHOOSE_WORKSPACE_CHANNEL, null, parseWorkspaceChoice),
  } satisfies DesktopProjectApi);
}

function failed<T>(code: DesktopBridgeFailureCode, message: string): DesktopProjectResult<T> {
  return { type: "failed", failure: { code, message } };
}
