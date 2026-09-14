import { describe, expect, it } from "vitest";

import { resolveHostLaunchConfig } from "../launch.js";

describe("resolveHostLaunchConfig", () => {
  it("selects the mock command and keeps credentials in the child environment", () => {
    const config = resolveHostLaunchConfig({
      appPath: "D:/work/Navo/frontend",
      execPath: "D:/apps/electron.exe",
      env: {
        NAVO_HOST_MODE: "mock",
        NAVO_REPO_ROOT: "D:/work/Navo",
        LLM_API_KEY: "secret",
        EXA_API_KEY: "exa-secret",
      },
    });

    expect(config.command).toBe("D:/apps/electron.exe");
    expect(config.args).toEqual([
      expect.stringMatching(/node_modules[\\/]tsx[\\/]dist[\\/]cli\.mjs$/),
      expect.stringMatching(/scripts[\\/]host[\\/]mock\.ts$/),
    ]);
    expect(config.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(config.readyMarker).toBe("[mock-kernel-host] ready");
    expect(config.secrets).toEqual(["secret", "exa-secret"]);
  });

  it("rejects unknown host modes", () => {
    expect(() => resolveHostLaunchConfig({
      appPath: ".",
      env: { NAVO_HOST_MODE: "other" },
    })).toThrow(/must be either real or mock/);
  });

  it("resolves the repository root when launched from built main output", () => {
    const config = resolveHostLaunchConfig({
      appPath: "D:/work/Navo/frontend/out/main",
      execPath: "D:/apps/electron.exe",
      env: { NAVO_HOST_MODE: "mock" },
    });

    expect(config.args).toEqual([
      expect.stringMatching(/Navo[\\/]node_modules[\\/]tsx[\\/]dist[\\/]cli\.mjs$/),
      expect.stringMatching(/Navo[\\/]scripts[\\/]host[\\/]mock\.ts$/),
    ]);
  });
});
