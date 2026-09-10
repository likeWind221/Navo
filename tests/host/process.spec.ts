import { spawn } from "node:child_process";
import type { ChildProcessWithoutNullStreams } from "node:child_process";
import {
  agentTurnV2Method,
  encodeNdjson,
  NdjsonDecoder,
  parseRpcServerFrame,
  sessionCommandMethod,
  StreamRpcClient,
} from "../../rpc/index.js";
import type { RpcClientFrame, RpcClientTransport } from "../../rpc/index.js";

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

  it("serves v2 turns and sidecar commands through the real stdio boundary", async () => {
    const child = startHost("scripts/host/mock.ts", {
      SKILLWORLD_MOCK_LLM_MODE: "completed",
    });
    const stderr = capture(child.stderr);
    await waitUntil(() => stderr.value.includes("[mock-kernel-host] ready"));
    const client = new StreamRpcClient(new ChildRpcTransport(child));
    const input = { sessionId: "process-session", requestId: "process-request", text: "hello" };
    try {
      const turn = await collect(client.stream(agentTurnV2Method, input));
      const started = turn.find((event) => event.type === "turn-started");
      expect(turn.map((event) => event.type)).toEqual([
        "turn-started",
        "step-started",
        "content-started",
        "content-delta",
        "content-completed",
        "step-completed",
        "turn-completed",
      ]);
      expect(started?.type === "turn-started" ? started.turnId : undefined).toBeTruthy();

      const command = await collect(client.stream(sessionCommandMethod, {
        sessionId: input.sessionId,
        commandId: "process-command",
        name: "hello",
        args: "",
      }));
      expect(command.map((event) => event.type)).toEqual([
        "command-started",
        "command-completed",
      ]);
      expect(command[1]).toMatchObject({
        summary: "hello",
        anchor: { kind: "turn", turnId: started?.type === "turn-started" ? started.turnId : "" },
      });
    } finally {
      await client.dispose();
    }
    await expect(exitOf(child)).resolves.toEqual({ code: 0, signal: null });
  });

  it("forwards a model failure as one terminal v2 event", async () => {
    const child = startHost("scripts/host/mock.ts", {
      SKILLWORLD_MOCK_LLM_MODE: "failed",
    });
    const stderr = capture(child.stderr);
    await waitUntil(() => stderr.value.includes("[mock-kernel-host] ready"));
    const client = new StreamRpcClient(new ChildRpcTransport(child));
    try {
      const events = await collect(client.stream(agentTurnV2Method, {
        sessionId: "process-session",
        requestId: "process-request",
        text: "fail",
      }));
      expect(events.at(-1)).toMatchObject({
        type: "turn-failed",
        failure: {
          code: "stream-output-interrupted",
          message: "Model stream failed after publishing live content.",
        },
      });
      expect(events.filter((event) => event.type === "turn-failed")).toHaveLength(1);
    } finally {
      await client.dispose();
    }
    await expect(exitOf(child)).resolves.toEqual({ code: 0, signal: null });
  });

  it("cancels a running v2 turn in the child process", async () => {
    const child = startHost("scripts/host/mock.ts", {
      SKILLWORLD_MOCK_LLM_MODE: "hang",
    });
    const stderr = capture(child.stderr);
    await waitUntil(() => stderr.value.includes("[mock-kernel-host] ready"));
    const client = new StreamRpcClient(new ChildRpcTransport(child));
    const controller = new AbortController();
    const iterator = client.stream(agentTurnV2Method, {
      sessionId: "process-session",
      requestId: "process-request",
      text: "wait",
    }, { signal: controller.signal });
    try {
      await expect(iterator.next()).resolves.toMatchObject({
        value: { type: "turn-started" },
      });
      controller.abort();
      await expect(iterator.next()).rejects.toMatchObject({ code: "cancelled" });
    } finally {
      await client.dispose();
    }
    await expect(exitOf(child)).resolves.toEqual({ code: 0, signal: null });
  });
});

class ChildRpcTransport implements RpcClientTransport {
  readonly incoming: AsyncIterable<unknown>;

  constructor(private readonly child: ChildProcessWithoutNullStreams) {
    this.incoming = readFrames(child.stdout);
  }

  send(frame: RpcClientFrame): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      this.child.stdin.write(encodeNdjson(frame), "utf8", (error) => {
        if (error) reject(error);
        else resolve();
      });
    });
  }

  close(): Promise<void> {
    if (this.child.stdin.writableEnded) return Promise.resolve();
    return new Promise<void>((resolve) => this.child.stdin.end(resolve));
  }
}

async function* readFrames(stream: NodeJS.ReadableStream): AsyncGenerator<unknown> {
  const decoder = new NdjsonDecoder(parseRpcServerFrame);
  for await (const chunk of stream) {
    const bytes = typeof chunk === "string" ? Buffer.from(chunk) : chunk as Uint8Array;
    yield* decoder.push(bytes);
  }
  yield* decoder.finish();
}

async function collect<TValue>(stream: AsyncIterable<TValue>): Promise<TValue[]> {
  const values: TValue[] = [];
  for await (const value of stream) values.push(value);
  return values;
}

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
