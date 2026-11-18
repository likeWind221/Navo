import { basename, dirname, resolve } from "node:path";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";

import type { KernelHostLaunchConfig } from "./process.js";

export type KernelHostMode = "real" | "mock";

export interface ResolveHostLaunchOptions {
  readonly appPath: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly execPath?: string;
  readonly runtime?: "node" | "electron";
  readonly home?: string;
}

export function resolveHostLaunchConfig(options: ResolveHostLaunchOptions): KernelHostLaunchConfig {
  const env = options.env ?? process.env;
  const runtime = options.runtime ?? (process.versions.electron === undefined ? "node" : "electron");
  const mode = parseMode(env.NAVO_HOST_MODE);
  const repoRoot = resolve(env.NAVO_REPO_ROOT ?? defaultRepoRoot(options.appPath));
  const tsxCli = resolve(repoRoot, "node_modules/tsx/dist/cli.mjs");
  const entry = resolve(repoRoot, mode === "mock" ? "scripts/host/mock.ts" : "src/host/main.ts");
  const childEnv = { ...env };
  delete childEnv.ELECTRON_RUN_AS_NODE;
  if (mode === "real" && env.LLM_API_KEY === undefined && env.DEEPSEEK_API_KEY === undefined && (env.LLM_PROVIDER === undefined || env.LLM_PROVIDER === "deepseek")) {
    const path = resolve(options.home ?? homedir(), ".config/navo/provider.json");
    if (existsSync(path)) {
      let config: unknown;
      try { config = JSON.parse(readFileSync(path, "utf8")); }
      catch { throw new Error("Unable to read Navo provider configuration"); }
      if (typeof config !== "object" || config === null || !("apiKey" in config) || typeof config.apiKey !== "string" || !config.apiKey.trim() || /[\r\n]/.test(config.apiKey)) {
        throw new Error("Navo provider configuration contains an invalid API key");
      }
      childEnv.DEEPSEEK_API_KEY = config.apiKey;
    }
  }
  return {
    command: env.NAVO_NODE_BIN?.trim()
      || (runtime === "electron" ? "node" : options.execPath ?? process.execPath),
    args: [tsxCli, entry],
    cwd: repoRoot,
    env: childEnv,
    readyMarker: mode === "mock" ? "[mock-kernel-host] ready" : "[kernel-host] ready",
    secrets: [childEnv.LLM_API_KEY ?? "", childEnv.DEEPSEEK_API_KEY ?? "", childEnv.EXA_API_KEY ?? ""],
  };
}

function defaultRepoRoot(appPath: string): string {
  const resolvedAppPath = resolve(appPath);
  if (basename(resolvedAppPath).toLowerCase() === "main"
    && basename(dirname(resolvedAppPath)).toLowerCase() === "out") {
    return resolve(resolvedAppPath, "..", "..", "..");
  }
  return resolve(resolvedAppPath, "..");
}

function parseMode(value: string | undefined): KernelHostMode {
  if (value === undefined || value === "real") return "real";
  if (value === "mock") return "mock";
  throw new Error("NAVO_HOST_MODE must be either real or mock");
}
