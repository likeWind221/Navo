import { resolve } from "node:path";

import type { KernelHostLaunchConfig } from "./kernel-host-process.js";

export type KernelHostMode = "real" | "mock";

export interface ResolveHostLaunchOptions {
  readonly appPath: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly execPath?: string;
}

export function resolveHostLaunchConfig(options: ResolveHostLaunchOptions): KernelHostLaunchConfig {
  const env = options.env ?? process.env;
  const mode = parseMode(env.SKILLWORLD_HOST_MODE);
  const repoRoot = resolve(env.SKILLWORLD_REPO_ROOT ?? resolve(options.appPath, ".."));
  const tsxCli = resolve(repoRoot, "node_modules/tsx/dist/cli.mjs");
  const entry = resolve(repoRoot, mode === "mock" ? "scripts/mock-kernel-host.ts" : "src/host/kernel-host.ts");
  return {
    command: options.execPath ?? process.execPath,
    args: [tsxCli, entry],
    cwd: repoRoot,
    env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
    readyMarker: mode === "mock" ? "[mock-kernel-host] ready" : "[kernel-host] ready",
    secrets: [env.LLM_API_KEY ?? ""],
  };
}

function parseMode(value: string | undefined): KernelHostMode {
  if (value === undefined || value === "real") return "real";
  if (value === "mock") return "mock";
  throw new Error("SKILLWORLD_HOST_MODE must be either real or mock");
}
