import { describe, expect, it } from "vitest";
import { StreamRpcClient, StreamRpcRouter, StreamRpcServer, agentTurnMethod, agentTurnV2Method, sessionCommandMethod } from "../index.js";
import type { RpcServerFrame } from "../index.js";
import { Channel, createTransportPair, collect } from "./helpers/transport.js";

describe("F3 RPC integration", () => {
  it("routes legacy, content and standalone command methods together", async () => {
    const pair = createTransportPair();
    const router = new StreamRpcRouter();
    router.register(agentTurnMethod, async function* () {
      yield { type: "started", turnId: "legacy" };
      yield { type: "completed" };
    });
    router.register(agentTurnV2Method, async function* (input) {
      const scope = { sessionId: input.sessionId, requestId: input.requestId, turnId: "new" };
      yield { ...scope, type: "turn-started" };
      yield { ...scope, stepId: "step", messageId: "message", type: "step-started" };
      yield { ...scope, stepId: "step", messageId: "message", type: "step-completed" };
      yield { ...scope, type: "turn-completed" };
    });
    router.register(sessionCommandMethod, async function* (input) {
      const scope = { sessionId: input.sessionId, commandId: input.commandId,
        name: input.name, anchor: { kind: "session" as const } };
      yield { ...scope, type: "command-started" as const };
      yield { ...scope, type: "command-completed" as const, summary: "ok" };
    });
    const server = new StreamRpcServer(pair.server, router);
    const serving = server.serve();
    const client = new StreamRpcClient(pair.client);
    try {
      const input = { sessionId: "s", requestId: "r", text: "hi" };
      expect(await collect(client.stream(agentTurnMethod, input))).toHaveLength(2);
      expect(await collect(client.stream(agentTurnV2Method, input))).toHaveLength(4);
      const notices = await collect(client.stream(sessionCommandMethod, { sessionId: "s", commandId: "c", name: "model", args: "" }));
      expect(notices.map(n => n.type)).toEqual(["command-started", "command-completed"]);
      expect(notices.every(n => n.anchor.kind === "session")).toBe(true);
    } finally {
      pair.close();
      await serving;
      await client.dispose();
    }
  });

  it("rejects cross-request output on both server and client", async () => {
    const pair = createTransportPair();
    const router = new StreamRpcRouter();
    router.register(agentTurnV2Method, async function* (input) {
      yield { type: "turn-started", sessionId: input.sessionId, requestId: "wrong", turnId: "t" };
    });
    const server = new StreamRpcServer(pair.server, router);
    const serving = server.serve();
    const client = new StreamRpcClient(pair.client);
    const input = { sessionId: "s", requestId: "r", text: "hi" };
    try {
      await expect(collect(client.stream(agentTurnV2Method, input))).rejects.toMatchObject({ failure: { code: "stream-failed" } });
    } finally {
      pair.close();
      await serving;
      await client.dispose();
    }
    const incoming = new Channel<RpcServerFrame>();
    const raw = new StreamRpcClient({ incoming, send(frame) {
      if (frame.type === "open") incoming.send({ version: 1, type: "item", id: frame.id,
        value: { type: "turn-started", sessionId: "wrong", requestId: "r", turnId: "t" } });
    }, close: () => incoming.close() });
    try {
      await expect(collect(raw.stream(agentTurnV2Method, input))).rejects.toMatchObject({ code: "invalid-output" });
    } finally { await raw.dispose(); }
  });

  it("cancels a command remotely and ignores its late success locally", async () => {
    const pair = createTransportPair();
    const router = new StreamRpcRouter();
    const aborted = Promise.withResolvers<void>();
    router.register(sessionCommandMethod, async function* (input, signal) {
      const scope = { sessionId: input.sessionId, commandId: input.commandId,
        name: input.name, anchor: { kind: "session" as const } };
      yield { ...scope, type: "command-started" as const };
      if (!signal.aborted) await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
      aborted.resolve();
      // Models a commit racing cancellation; local cancellation is not rollback confirmation.
      yield { ...scope, type: "command-completed" as const, summary: "ok" };
    });
    const server = new StreamRpcServer(pair.server, router);
    const serving = server.serve();
    const client = new StreamRpcClient(pair.client);
    const controller = new AbortController();
    const iterator = client.stream(sessionCommandMethod, { sessionId: "s", commandId: "c", name: "model", args: "" }, { signal: controller.signal });
    try {
      await expect(iterator.next()).resolves.toMatchObject({ value: { type: "command-started" } });
      controller.abort();
      await expect(iterator.next()).rejects.toMatchObject({ code: "cancelled" });
      await aborted.promise;
    } finally {
      pair.close();
      await serving;
      await client.dispose();
    }
  });
});
