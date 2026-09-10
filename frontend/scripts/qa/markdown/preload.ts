import { contextBridge, ipcRenderer } from "electron";
import type { DesktopAgentApi, DesktopAgentEvent } from "../../../shared/agent.js";

const agent: DesktopAgentApi = {
  startTurn: (input) => ipcRenderer.invoke("markdown:start", input),
  cancelTurn: (requestId) => ipcRenderer.invoke("markdown:cancel", requestId),
  startCommand: async () => { throw new Error("Commands are not part of Markdown QA"); },
  cancelCommand: async () => {},
  onEvent: (listener) => {
    const receive = (_event: Electron.IpcRendererEvent, update: DesktopAgentEvent): void => listener(update);
    ipcRenderer.on("markdown:event", receive);
    return () => ipcRenderer.removeListener("markdown:event", receive);
  },
  onTurnUpdate: () => () => {},
};

contextBridge.exposeInMainWorld("desktop", { platform: process.platform, versions: process.versions, agent });
