import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import { describe, expect, it } from "vitest";

describe("Kernel Host process lifecycle", () => {
  it("starts the real Host without exposing configuration on stdout and exits on stdin EOF", async () => {
    const child = startHost("src/host/main.ts");
    const stderr = capture(child.stderr);
    const stdout = capture(child.stdout);
    await waitUntil(() => stderr.value.includes("[kernel-host] ready"));

    child.stdin.end();
    await expect(exitOf(child)).resolves.toEqual({ code: 0, signal: null });
    expect(stdout.value).toBe("");
    expect(stderr.value).not.toContain("LLM_API_KEY");
  });

  it("runs the scripted Mock Host and exposes a deterministic crash for Main supervision", async () => {
    const child = startHost("scripts/host/mock.ts", {
      SKILLWORLD_MOCK_MODE: "crash",
      SKILLWORLD_MOCK_TEXT: "before-crash",
      SKILLWORLD_MOCK_CHUNK_CHARS: "64",
    });
    const stderr = capture(child.stderr);
    const stdout = capture(child.stdout);
    await waitUntil(() => stderr.value.includes("[mock-kernel-host] ready"));
    child.stdin.write(`${JSON.stringify({
      version: 1,
      type: "open",
      id: "rpc-crash",
      method: "agent.turn",
      params: { sessionId: "session", requestId: "request", text: "hello" },
    })}\n`);

    await expect(exitOf(child)).resolves.toEqual({ code: 23, signal: null });
    const frames = stdout.value.trim().split("\n").map((line) => JSON.parse(line));
    expect(frames).toMatchObject([
      { type: "item", value: { type: "started" } },
      { type: "item", value: { type: "text-delta", text: "before-crash" } },
    ]);
  });

  it("exits promptly when Electron terminates the Host process", async () => {
    const child = startHost("scripts/host/mock.ts");
    const stderr = capture(child.stderr);
    await waitUntil(() => stderr.value.includes("[mock-kernel-host] ready"));

    expect(child.kill()).toBe(true);
    const result = await exitOf(child);
    expect(result.code === 0 || result.signal === "SIGTERM").toBe(true);
  });
});

function startHost(
  entry: string,
  extraEnv: Readonly<Record<string, string>> = {},
): ChildProcessWithoutNullStreams {
  return spawn(process.execPath, ["--import", "tsx", entry], {
    cwd: process.cwd(),
    env: { ...process.env, ...extraEnv },
    stdio: ["pipe", "pipe", "pipe"],
    windowsHide: true,
  });
}

function capture(stream: NodeJS.ReadableStream): { readonly value: string } {
  let value = "";
  stream.setEncoding("utf8");
  stream.on("data", (chunk: string) => { value += chunk; });
  return {
    get value() {
      return value;
    },
  };
}

function exitOf(
  child: ChildProcessWithoutNullStreams,
): Promise<{ readonly code: number | null; readonly signal: NodeJS.Signals | null }> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("Host process did not exit within 5 seconds."));
    }, 5_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      resolve({ code, signal });
    });
  });
}

async function waitUntil(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!condition()) {
    if (Date.now() >= deadline) throw new Error("Host process did not become ready.");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}
