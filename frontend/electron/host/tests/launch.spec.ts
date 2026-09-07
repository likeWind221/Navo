import { describe, expect, it } from "vitest";

import { resolveHostLaunchConfig } from "../launch.js";

describe("resolveHostLaunchConfig", () => {
  it("selects the mock command and keeps credentials in the child environment", () => {
    const config = resolveHostLaunchConfig({
      appPath: "D:/work/SkillWorld/frontend",
      execPath: "D:/apps/electron.exe",
      env: {
        SKILLWORLD_HOST_MODE: "mock",
        SKILLWORLD_REPO_ROOT: "D:/work/SkillWorld",
        LLM_API_KEY: "secret",
      },
    });

    expect(config.command).toBe("D:/apps/electron.exe");
    expect(config.args).toEqual([
      expect.stringMatching(/node_modules[\\/]tsx[\\/]dist[\\/]cli\.mjs$/),
      expect.stringMatching(/scripts[\\/]host[\\/]mock\.ts$/),
    ]);
    expect(config.env.ELECTRON_RUN_AS_NODE).toBe("1");
    expect(config.readyMarker).toBe("[mock-kernel-host] ready");
    expect(config.secrets).toEqual(["secret"]);
  });

  it("rejects unknown host modes", () => {
    expect(() => resolveHostLaunchConfig({
      appPath: ".",
      env: { SKILLWORLD_HOST_MODE: "other" },
    })).toThrow(/must be either real or mock/);
  });
});
