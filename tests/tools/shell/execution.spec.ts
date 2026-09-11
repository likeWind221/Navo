import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  runShellCommand,
} from "../../../src/tools/builtins/shell/execution.js";
import {
  candidateShellPaths,
  resolveShellProfile,
  shellInvocation,
} from "../../../src/tools/builtins/shell/profile.js";
import { SHELL_LIMITS } from "../../../src/tools/builtins/shell/types.js";

const root = tmpdir();
const profile = resolveShellProfile({});
const signal = new AbortController().signal;

function nodeCommand(script: string): string {
  return profile.kind === "powershell" ? `node -e "${script}"` : `node -e '${script}'`;
}

describe("shell resolution", () => {
  it("orders candidates per platform and keeps Windows bash off PATH", () => {
    expect(candidateShellPaths("powershell", {
      ProgramFiles: "C:\\PF",
      SystemRoot: "C:\\W",
      PATH: "\"C:\\Tools\";;node_modules\\.bin;C:\\Other",
    }, "win32")).toEqual([
      "C:\\PF\\PowerShell\\7\\pwsh.exe",
      "C:\\Tools\\pwsh.exe",
      "C:\\Other\\pwsh.exe",
      "C:\\W\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
      "pwsh",
    ]);

    expect(candidateShellPaths("bash", { ProgramFiles: "C:\\PF" }, "win32"))
      .toEqual(["C:\\PF\\Git\\bin\\bash.exe"]);
    expect(candidateShellPaths("bash", { ProgramFiles: "C:\\PF", LOCALAPPDATA: "C:\\LA" }, "win32"))
      .toEqual(["C:\\PF\\Git\\bin\\bash.exe", "C:\\LA\\Programs\\Git\\bin\\bash.exe"]);
    expect(candidateShellPaths("bash", {}, "linux")).toEqual(["/bin/bash", "bash"]);
  });

  it("builds dialect-specific invocations and environments", () => {
    const powershell = shellInvocation("powershell", "Get-ChildItem");
    expect(powershell.slice(0, 4)).toEqual(["-NoLogo", "-NoProfile", "-NonInteractive", "-Command"]);
    expect(powershell[4]).toContain("OutputEncoding");
    expect(powershell[4]).toContain("Get-ChildItem");
    expect(powershell[4]?.endsWith("exit $LASTEXITCODE")).toBe(true);
    expect(shellInvocation("bash", "ls -la")).toEqual(["-c", "ls -la"]);

    const posix = resolveShellProfile({ kind: "bash", platform: "linux" });
    expect(posix.env).toMatchObject({ TERM: "dumb", NO_COLOR: "1" });
    expect(profile.env).not.toHaveProperty("TERM");
    expect(posix.name).toBe("bash");
    expect(profile.name).toMatch(/PowerShell/);
  });
});

describe("shell execution", () => {
  it("runs in the execution world and decodes UTF-8 output", async () => {
    const result = await runShellCommand(
      { cwd: root },
      { command: nodeCommand("process.stdout.write(require('path').basename(process.cwd()) + '|中文')"), timeoutMs: 30_000 },
      signal,
      profile,
    );
    expect(result.exitCode).toBe(0);
    expect(result.stdout.text).toBe(`${basename(root)}|中文`);
    expect(result.stderr.text).toBe("");
    expect(result.timedOut).toBe(false);
    expect(result.aborted).toBe(false);
  });

  it("separates stderr from stdout and returns non-zero exits as results", async () => {
    const failed = await runShellCommand(
      { cwd: root },
      { command: nodeCommand("process.stderr.write('boom'); process.exit(3)"), timeoutMs: 30_000 },
      signal,
      profile,
    );
    expect(failed.exitCode).toBe(3);
    expect(failed.stdout.text).toBe("");
    expect(failed.stderr.text).toBe("boom");
  });

  it("keeps the tail of an oversized stream and flags truncation", async () => {
    const result = await runShellCommand(
      { cwd: root },
      { command: nodeCommand("process.stdout.write('a'.repeat(100000) + 'TAIL')"), timeoutMs: 30_000 },
      signal,
      profile,
    );
    expect(result.stdout.truncated).toBe(true);
    expect(result.stdout.text.length).toBe(SHELL_LIMITS.maxOutputBytes);
    expect(result.stdout.text.endsWith("TAIL")).toBe(true);
  });

  it("kills the process tree on timeout and marks the result", async () => {
    const result = await runShellCommand(
      { cwd: root },
      { command: nodeCommand("setTimeout(() => {}, 60000)"), timeoutMs: 500 },
      signal,
      profile,
    );
    expect(result.timedOut).toBe(true);
    expect(result.aborted).toBe(false);
    expect(result.timeoutMs).toBe(500);
  });

  it("kills the process tree on cancellation and marks the result", async () => {
    const controller = new AbortController();
    const pending = runShellCommand(
      { cwd: root },
      { command: nodeCommand("setTimeout(() => {}, 60000)"), timeoutMs: 30_000 },
      controller.signal,
      profile,
    );
    setTimeout(() => controller.abort(), 200);

    const result = await pending;
    expect(result.aborted).toBe(true);
    expect(result.timedOut).toBe(false);
  });

  it("reports spawn failures and already-fired deadlines", async () => {
    await expect(runShellCommand(
      { cwd: root },
      { command: "echo hi", timeoutMs: 30_000 },
      signal,
      { ...profile, executable: join(root, "missing-shell.exe") },
    )).rejects.toMatchObject({ code: "spawn-failed" });

    const controller = new AbortController();
    controller.abort();
    await expect(runShellCommand(
      { cwd: root },
      { command: nodeCommand("process.exit(0)"), timeoutMs: 30_000 },
      controller.signal,
      profile,
    )).rejects.toMatchObject({ code: "aborted" });
  });
});
