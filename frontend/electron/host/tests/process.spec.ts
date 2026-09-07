import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { agentTurnMethod, RpcError } from "../../../../rpc/index.js";
import { KernelHostProcess } from "../process.js";

const repoRoot = resolve(fileURLToPath(new URL("../../../../", import.meta.url)));
const tsxCli = resolve(repoRoot, "node_modules/tsx/dist/cli.mjs");
const mockHost = resolve(repoRoot, "scripts/host/mock.ts");

describe("KernelHostProcess", () => {
  it("starts one Mock Host and routes a complete stream", async () => {
    const host = createMockHost({ SKILLWORLD_MOCK_TEXT: "测试回复", SKILLWORLD_MOCK_CHUNK_CHARS: "2" });
    const first = host.start();
    const second = host.start();
    expect(first).toBe(second);

    const events = [];
    for await (const event of host.stream(agentTurnMethod, {
      sessionId: "session-1",
      requestId: "request-1",
      text: "你好",
    })) events.push(event);

    expect(events[0]?.type).toBe("started");
    expect(events.filter((event) => event.type === "text-delta").map((event) => event.text).join(""))
      .toBe("测试回复");
    expect(events.at(-1)).toEqual({ type: "completed" });
    await host.close();
  });

  it("propagates cancellation and closes a hanging Host", async () => {
    const host = createMockHost({ SKILLWORLD_MOCK_MODE: "hang" });
    const controller = new AbortController();
    const consume = (async () => {
      for await (const event of host.stream(agentTurnMethod, {
        sessionId: "session-2",
        requestId: "request-2",
        text: "等待",
      }, { signal: controller.signal })) {
        if (event.type === "started") controller.abort();
      }
    })();

    await expect(consume).rejects.toMatchObject({ code: "cancelled" } satisfies Partial<RpcError>);
    await host.close();
  });

  it("turns a Host crash into a closed RPC stream", async () => {
    const host = createMockHost({ SKILLWORLD_MOCK_MODE: "crash" });
    const consume = (async () => {
      for await (const _event of host.stream(agentTurnMethod, {
        sessionId: "session-3",
        requestId: "request-3",
        text: "崩溃",
      })) { /* consume until failure */ }
    })();

    await expect(consume).rejects.toMatchObject({ code: "connection-closed" } satisfies Partial<RpcError>);
    await host.close();
  });

  it("rejects when the child cannot start", async () => {
    const host = new KernelHostProcess({
      command: resolve(repoRoot, "missing-kernel-host-command"),
      args: [],
      cwd: repoRoot,
      env: process.env,
      readyMarker: "ready",
      startTimeoutMs: 500,
      stopTimeoutMs: 500,
    }, () => undefined);

    await expect(host.start()).rejects.toBeInstanceOf(Error);
    await host.close();
  });
});

function createMockHost(overrides: NodeJS.ProcessEnv): KernelHostProcess {
  return new KernelHostProcess({
    command: process.execPath,
    args: [tsxCli, mockHost],
    cwd: repoRoot,
    env: { ...process.env, ...overrides },
    readyMarker: "[mock-kernel-host] ready",
    startTimeoutMs: 5_000,
    stopTimeoutMs: 2_000,
  }, () => undefined);
}
