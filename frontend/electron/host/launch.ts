import { basename, dirname, resolve } from "node:path";

import type { KernelHostLaunchConfig } from "./process.js";

export type KernelHostMode = "real" | "mock";

export interface ResolveHostLaunchOptions {
  readonly appPath: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly execPath?: string;
}

export function resolveHostLaunchConfig(options: ResolveHostLaunchOptions): KernelHostLaunchConfig {
  const env = options.env ?? process.env;
  const mode = parseMode(env.SKILLWORLD_HOST_MODE);
  const repoRoot = resolve(env.SKILLWORLD_REPO_ROOT ?? defaultRepoRoot(options.appPath));
  const tsxCli = resolve(repoRoot, "node_modules/tsx/dist/cli.mjs");
  const entry = resolve(repoRoot, mode === "mock" ? "scripts/host/mock.ts" : "src/host/main.ts");
  return {
    command: options.execPath ?? process.execPath,
    args: [tsxCli, entry],
    cwd: repoRoot,
    env: { ...env, ELECTRON_RUN_AS_NODE: "1" },
    readyMarker: mode === "mock" ? "[mock-kernel-host] ready" : "[kernel-host] ready",
    secrets: [env.LLM_API_KEY ?? "", env.EXA_API_KEY ?? ""],
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
  throw new Error("SKILLWORLD_HOST_MODE must be either real or mock");
}
