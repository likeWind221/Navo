/// <reference types="vite/client" />

import type { DesktopAgentApi } from "./agent/desktop-agent-contract";

declare global {
  interface Window {
    readonly desktop: {
      readonly platform: string;
      readonly versions: {
        readonly chrome: string;
        readonly electron: string;
      };
      readonly agent: DesktopAgentApi;
    };
  }
}

export {};
