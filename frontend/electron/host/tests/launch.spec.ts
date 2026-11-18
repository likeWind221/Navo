import { describe, expect, it } from "vitest";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveHostLaunchConfig } from "../launch.js";

describe("resolveHostLaunchConfig", () => {
  it("loads the local DeepSeek key and preserves explicit environment precedence", () => {
    const home = mkdtempSync(join(tmpdir(), "navo-provider-"));
    try {
      mkdirSync(join(home, ".config", "navo"), { recursive: true });
      writeFileSync(join(home, ".config", "navo", "provider.json"), JSON.stringify({ apiKey: "local-key" }));
      const local = resolveHostLaunchConfig({ appPath: ".", home, env: {} });
      expect(local.env.DEEPSEEK_API_KEY).toBe("local-key");
      expect(local.secrets).toContain("local-key");
      const explicit = resolveHostLaunchConfig({ appPath: ".", home, env: { LLM_API_KEY: "explicit-key" } });
      expect(explicit.env.DEEPSEEK_API_KEY).toBeUndefined();
      expect(explicit.env.LLM_API_KEY).toBe("explicit-key");
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
  it("starts the mock with standalone Node and keeps credentials in the child environment", () => {
    const config = resolveHostLaunchConfig({
      appPath: "D:/work/Navo/frontend",
      execPath: "D:/apps/electron.exe",
      runtime: "electron",
      env: {
        NAVO_HOST_MODE: "mock",
        NAVO_REPO_ROOT: "D:/work/Navo",
        LLM_API_KEY: "secret",
        DEEPSEEK_API_KEY: "test-key",
        EXA_API_KEY: "exa-secret",
        ELECTRON_RUN_AS_NODE: "1",
      },
    });

    expect(config.command).toBe("node");
    expect(config.args).toEqual([
      expect.stringMatching(/node_modules[\\/]tsx[\\/]dist[\\/]cli\.mjs$/),
      expect.stringMatching(/scripts[\\/]host[\\/]mock\.ts$/),
    ]);
    expect(config.env).not.toHaveProperty("ELECTRON_RUN_AS_NODE");
    expect(config.readyMarker).toBe("[mock-kernel-host] ready");
    expect(config.secrets).toEqual(["secret", "test-key", "exa-secret"]);
  });

  it("allows an explicit Node executable override", () => {
    const config = resolveHostLaunchConfig({
      appPath: "D:/work/Navo/frontend",
      runtime: "electron",
      env: {
        NAVO_HOST_MODE: "mock",
        NAVO_REPO_ROOT: "D:/work/Navo",
        NAVO_NODE_BIN: "D:/runtime/node.exe",
      },
    });

    expect(config.command).toBe("D:/runtime/node.exe");
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
