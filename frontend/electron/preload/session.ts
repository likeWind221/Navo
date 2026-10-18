import { parseSessionContextSnapshot, parseSessionHistory } from "../../../rpc/session/validation.js";
import type {
  DesktopSessionApi,
  DesktopSessionEventListener,
  DesktopSessionResult,
} from "../../shared/session.js";
import {
  parseDesktopSessionEvent,
  parseDesktopSessionFollowHandle,
  parseDesktopSessionNull,
  parseDesktopSessionResult,
} from "../../shared/session/validation.js";
import {
  SESSION_CONTEXT_EVENT_CHANNEL,
  SESSION_CONTEXT_FOLLOW_CANCEL_CHANNEL,
  SESSION_CONTEXT_FOLLOW_START_CHANNEL,
  SESSION_CONTEXT_GET_CHANNEL,
  SESSION_CONTEXT_HISTORY_CHANNEL,
} from "../../shared/session/channels.js";

export interface SessionIpcRenderer {
  invoke(channel: string, value: unknown): Promise<unknown>;
  on(channel: string, listener: (event: unknown, value: unknown) => void): void;
  removeListener(channel: string, listener: (event: unknown, value: unknown) => void): void;
}

export function createDesktopSessionApi(
  ipc: SessionIpcRenderer,
  reportInvalidUpdate: () => void = () => console.error("[preload] dropped invalid Session context event"),
): DesktopSessionApi {
  async function request<T>(
    channel: string,
    input: unknown,
    parse: (value: unknown) => T,
  ): Promise<DesktopSessionResult<T>> {
    let raw: unknown;
    try {
      raw = await ipc.invoke(channel, input);
    } catch {
      return failed<T>("bridge-closed", "Session bridge is closed");
    }
    try {
      return parseDesktopSessionResult(raw, parse);
    } catch {
      return failed<T>("invalid-output", "Session bridge returned a malformed result");
    }
  }

  return Object.freeze({
    getContext: input => request(SESSION_CONTEXT_GET_CHANNEL, input, parseSessionContextSnapshot),
    getHistory: input => request(SESSION_CONTEXT_HISTORY_CHANNEL, input, parseSessionHistory),
    startContextFollow: input =>
      request(SESSION_CONTEXT_FOLLOW_START_CHANNEL, input, parseDesktopSessionFollowHandle),
    cancelContextFollow: subscriptionId =>
      request(SESSION_CONTEXT_FOLLOW_CANCEL_CHANNEL, subscriptionId, parseDesktopSessionNull),
    onContextEvent(listener: DesktopSessionEventListener): () => void {
      const receive = (_event: unknown, candidate: unknown): void => {
        try {
          listener(parseDesktopSessionEvent(candidate));
        } catch {
          reportInvalidUpdate();
        }
      };
      ipc.on(SESSION_CONTEXT_EVENT_CHANNEL, receive);
      return () => ipc.removeListener(SESSION_CONTEXT_EVENT_CHANNEL, receive);
    },
  } satisfies DesktopSessionApi);
}

function failed<T>(
  code: "invalid-output" | "bridge-closed",
  message: string,
): DesktopSessionResult<T> {
  return { type: "failed", failure: { code, message } };
}
