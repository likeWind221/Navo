import { spawn, spawnSync } from "node:child_process";

import { ShellError } from "./errors.js";
import { shellInvocation, type ResolvedShellProfile } from "./profile.js";
import type { FileEnvironment } from "../file/path.js";
import {
  SHELL_LIMITS,
  type ShellExecSpec,
  type ShellResult,
  type ShellStreamOutput,
} from "./types.js";

const SENSITIVE_ENV_NAME = /KEY|PASSWORD|SECRET|TOKEN/i;

const TIMED_OUT = new Error("Shell command timed out.");

export async function runShellCommand(
  environment: FileEnvironment,
  spec: ShellExecSpec,
  signal: AbortSignal,
  profile: ResolvedShellProfile,
): Promise<ShellResult> {
  const timeout = new AbortController();
  const timeoutId = setTimeout(() => timeout.abort(TIMED_OUT), spec.timeoutMs);
  const deadline = AbortSignal.any([signal, timeout.signal]);
  const stdout = new TailBuffer(SHELL_LIMITS.maxOutputBytes);
  const stderr = new TailBuffer(SHELL_LIMITS.maxOutputBytes);
  let graceTimer: ReturnType<typeof setTimeout> | undefined;

  try {
    if (deadline.aborted) {
      throw new ShellError("aborted", "Shell command was cancelled before it started.");
    }

    const child = spawn(profile.executable, [...shellInvocation(profile.kind, spec.command)], {
      cwd: environment.cwd,
      env: { ...scrubbedEnvironment(process.env), ...profile.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });

    const diagOn = process.env.NAVO_SHELL_DIAG === "1";
    const t0 = Date.now();
    const diag = (line: string): void => { if (diagOn) process.stderr.write(`[shell-diag] pid=${child.pid} +${Date.now() - t0}ms ${line}
`); };
    let closed = false;
    child.once("spawn", () => diag("spawn"));
    child.once("exit", (code, sig) => diag(`exit code=${code} sig=${sig}`));
    child.once("close", () => { closed = true; diag("close"); });
    const terminate = (): void => {
      if (child.pid === undefined) return;
      if (process.platform === "win32") {
        diag("abort");
        const k0 = Date.now();
        const r = spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { encoding: "utf8" });
        diag(`taskkill status=${r.status} ms=${Date.now() - k0} out=${JSON.stringify((r.stdout ?? "").trim())} err=${JSON.stringify((r.stderr ?? "").trim())}`);
        if (diagOn) {
          setTimeout(() => { if (!closed) diag(`STILL-OPEN tree-after=${descendants(child.pid as number)}`); }, 2000).unref();
        }
        return;
      }
      signalGroup(child.pid, "SIGTERM");
      graceTimer = setTimeout(() => signalGroup(child.pid as number, "SIGKILL"), SHELL_LIMITS.graceMs);
    };
    deadline.addEventListener("abort", terminate, { once: true });

    child.stdout?.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    const outcome = await new Promise<ShellOutcome>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (exitCode, termSignal) => resolve({ exitCode, signal: termSignal }));
    });
    deadline.removeEventListener("abort", terminate);

    const timedOut = deadline.aborted && deadline.reason === TIMED_OUT;
    return {
      exitCode: outcome.exitCode,
      signal: outcome.signal,
      timedOut,
      aborted: deadline.aborted && !timedOut,
      timeoutMs: spec.timeoutMs,
      stdout: stdout.output(),
      stderr: stderr.output(),
    };
  } catch (error: unknown) {
    if (error instanceof ShellError) throw error;
    throw new ShellError(
      "spawn-failed",
      `Shell command could not be started: ${errorMessage(error)}`,
      { cause: error },
    );
  } finally {
    clearTimeout(timeoutId);
    clearTimeout(graceTimer);
  }
}

interface ShellOutcome {
  readonly exitCode: number | null;
  readonly signal: NodeJS.Signals | null;
}

class TailBuffer {
  private readonly chunks: Buffer[] = [];
  private bytes = 0;
  private dropped = false;

  constructor(private readonly maxBytes: number) {}

  push(chunk: Buffer): void {
    this.chunks.push(chunk);
    this.bytes += chunk.length;
    while (this.bytes > this.maxBytes) {
      const head = this.chunks[0] as Buffer;
      const excess = this.bytes - this.maxBytes;
      if (head.length <= excess) {
        this.chunks.shift();
        this.bytes -= head.length;
      } else {
        this.chunks[0] = head.subarray(excess);
        this.bytes -= excess;
      }
      this.dropped = true;
    }
  }

  output(): ShellStreamOutput {
    return {
      text: Buffer.concat(this.chunks).toString("utf8"),
      truncated: this.dropped,
    };
  }
}

function descendants(root: number): string {
  const r = spawnSync("powershell", ["-NoProfile", "-Command",
    "Get-CimInstance Win32_Process | Select-Object ProcessId,ParentProcessId,Name,CommandLine | ConvertTo-Json -Compress"],
  { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  let rows: { ProcessId: number; ParentProcessId: number; Name: string; CommandLine: string | null }[] = [];
  try { rows = JSON.parse(r.stdout); } catch { return `unparsed status=${r.status}`; }
  const ids = new Set([root]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const row of rows) if (ids.has(row.ParentProcessId) && !ids.has(row.ProcessId)) { ids.add(row.ProcessId); grew = true; }
  }
  const tree = rows.filter(row => ids.has(row.ProcessId)).map(row => `${row.ProcessId}<${row.ParentProcessId}:${row.Name}`);
  const sleepers = rows.filter(row => row.CommandLine?.includes("60000")).map(row => `${row.ProcessId}<${row.ParentProcessId}:${row.Name}`);
  return JSON.stringify({ tree, sleepers });
}

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    return;
  }
}

function scrubbedEnvironment(env: NodeJS.ProcessEnv): Record<string, string> {
  const scrubbed: Record<string, string> = {};
  for (const [name, value] of Object.entries(env)) {
    if (value === undefined || SENSITIVE_ENV_NAME.test(name)) continue;
    scrubbed[name] = value;
  }
  return scrubbed;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
