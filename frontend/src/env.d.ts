/// <reference types="vite/client" />

import type { DesktopAgentApi } from "../shared/agent.js";
import type { DesktopProjectApi } from "../shared/project.js";
import type { DesktopSessionApi } from "../shared/session.js";

declare global {
  interface Window {
    readonly desktop: {
      readonly platform: string;
      readonly versions: {
        readonly chrome: string;
        readonly electron: string;
      };
      readonly agent: DesktopAgentApi;
      readonly project: DesktopProjectApi;
      readonly session: DesktopSessionApi;
    };
  }
}

export {};
