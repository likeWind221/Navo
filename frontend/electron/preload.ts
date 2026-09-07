import { contextBridge, ipcRenderer } from "electron";
import { createDesktopAgentApi } from "./preload/agent.js";

const desktopApi = Object.freeze({
  platform: process.platform,
  versions: Object.freeze({
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  }),
  agent: createDesktopAgentApi(ipcRenderer),
});

contextBridge.exposeInMainWorld("desktop", desktopApi);
