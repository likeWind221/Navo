import { lstatSync } from "node:fs";
import { basename, isAbsolute, posix, win32 } from "node:path";

import { ShellError } from "./errors.js";
import type { ShellKind, ShellPathStyle } from "./types.js";

export interface ShellResolution {
  readonly kind?: ShellKind | undefined;
  readonly path?: string | undefined;
  readonly env?: NodeJS.ProcessEnv | undefined;
  readonly platform?: NodeJS.Platform | undefined;
}

export interface ResolvedShellProfile {
  readonly kind: ShellKind;
  readonly name: string;
  readonly pathStyle: ShellPathStyle;
  readonly executable: string;
  readonly env: Readonly<Record<string, string>>;
}

const POWERSHELL_ENCODING_PREAMBLE =
  "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false); "
  + "$OutputEncoding = [System.Text.UTF8Encoding]::new($false); ";

const POWERSHELL_EXIT_STATUS_SUFFIX = "\nexit $LASTEXITCODE";

const BASE_ENV_OVERRIDES = Object.freeze({
  NO_COLOR: "1",
  PAGER: "cat",
  GIT_PAGER: "cat",
});

const BASH_ENV_OVERRIDES = Object.freeze({
  ...BASE_ENV_OVERRIDES,
  TERM: "dumb",
});

export function resolveShellProfile(options: ShellResolution): ResolvedShellProfile {
  const env = options.env ?? process.env;
  const platform = options.platform ?? process.platform;
  const kind = options.kind ?? (platform === "win32" ? "powershell" : "bash");
  const executable = options.path ?? firstExisting(candidateShellPaths(kind, env, platform));
  return Object.freeze({
    kind,
    name: shellDisplayName(kind, executable),
    pathStyle: kind === "powershell" ? "windows" : "posix",
    executable,
    env: kind === "powershell" ? BASE_ENV_OVERRIDES : BASH_ENV_OVERRIDES,
  });
}

export function candidateShellPaths(
  kind: ShellKind,
  env: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
): readonly string[] {
  if (kind === "powershell") {
    if (platform !== "win32") return ["pwsh"];
    const programFiles = env.ProgramFiles ?? "C:\\Program Files";
    const systemRoot = env.SystemRoot ?? "C:\\Windows";
    return [
      win32.join(programFiles, "PowerShell", "7", "pwsh.exe"),
      ...absolutePathEntries(env.PATH).map((entry) => win32.join(entry, "pwsh.exe")),
      win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      "pwsh",
    ];
  }
  if (platform === "win32") {
    const programFiles = env.ProgramFiles ?? "C:\\Program Files";
    const localAppData = env.LOCALAPPDATA;
    return [
      win32.join(programFiles, "Git", "bin", "bash.exe"),
      ...(localAppData === undefined
        ? []
        : [win32.join(localAppData, "Programs", "Git", "bin", "bash.exe")]),
    ];
  }
  return [posix.join("/bin", "bash"), "bash"];
}

export function shellInvocation(
  kind: ShellKind,
  command: string,
): readonly string[] {
  return kind === "powershell"
    ? [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-Command",
        `${POWERSHELL_ENCODING_PREAMBLE}${command}${POWERSHELL_EXIT_STATUS_SUFFIX}`,
      ]
    : ["-c", command];
}

function firstExisting(candidates: readonly string[]): string {
  for (const candidate of candidates) {
    if (!isAbsolute(candidate) || candidateExists(candidate)) return candidate;
  }
  throw new ShellError(
    "invalid-config",
    `No shell executable found. Tried: ${candidates.join(", ")}`,
  );
}

function candidateExists(candidate: string): boolean {
  try {
    const stats = lstatSync(candidate);
    return stats.isFile() || stats.isSymbolicLink();
  } catch {
    return false;
  }
}

function absolutePathEntries(value: string | undefined): string[] {
  return (value ?? "")
    .split(";")
    .map((entry) => entry.trim().replace(/^"|"$/g, ""))
    .filter((entry) => win32.isAbsolute(entry));
}

function shellDisplayName(kind: ShellKind, executable: string): string {
  const name = basename(executable).toLowerCase();
  if (kind === "bash") return name === "bash.exe" ? "Git Bash" : "bash";
  return name === "powershell.exe" ? "Windows PowerShell 5.1" : "PowerShell 7 (pwsh)";
}
