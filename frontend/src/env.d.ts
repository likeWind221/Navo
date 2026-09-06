/// <reference types="vite/client" />

interface Window {
  readonly desktop: {
    readonly platform: string;
    readonly versions: {
      readonly chrome: string;
      readonly electron: string;
    };
  };
}
