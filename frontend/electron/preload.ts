import { contextBridge, ipcRenderer } from "electron";
import { createDesktopAgentApi } from "./preload/agent.js";
import { createDesktopProjectApi } from "./preload/project.js";
import { createDesktopResourceApi } from "./preload/resource.js";
import { createDesktopSessionApi } from "./preload/session.js";

const desktopApi = Object.freeze({
  platform: process.platform,
  versions: Object.freeze({
    chrome: process.versions.chrome,
    electron: process.versions.electron,
  }),
  agent: createDesktopAgentApi(ipcRenderer),
  project: createDesktopProjectApi(ipcRenderer),
  resource: createDesktopResourceApi(ipcRenderer),
  session: createDesktopSessionApi(ipcRenderer),
});

contextBridge.exposeInMainWorld("desktop", desktopApi);
