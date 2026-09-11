import { spawn, spawnSync } from "node:child_process";

import { ShellError } from "./errors.js";
import { shellInvocation, type ResolvedShellProfile } from "./profile.js";
import type { FileExecutionWorld } from "../file/path.js";
import {
  SHELL_LIMITS,
  type ShellExecSpec,
  type ShellResult,
  type ShellStreamOutput,
} from "./types.js";

const SENSITIVE_ENV_NAME = /KEY|PASSWORD|SECRET|TOKEN/i;

const TIMED_OUT = new Error("Shell command timed out.");

export async function runShellCommand(
  world: FileExecutionWorld,
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
      cwd: world.cwd,
      env: { ...scrubbedEnvironment(process.env), ...profile.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
      detached: process.platform !== "win32",
    });

    const terminate = (): void => {
      if (child.pid === undefined) return;
      if (process.platform === "win32") {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
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
