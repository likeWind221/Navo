import { describe, expect, it } from "vitest";
import {
  RpcError,
  StreamRpcClient,
  StreamRpcRouter,
  StreamRpcServer,
  agentTurnMethod,
} from "../index.js";
import type {
  RpcClientFrame,
  RpcClientTransport,
  RpcServerFrame,
  RpcServerTransport,
  RpcMethod,
} from "../index.js";

class Channel<T> implements AsyncIterable<T> {
  private readonly values: T[] = [];
  private readonly waiters: Array<(value: IteratorResult<T>) => void> = [];
  private closed = false;

  send(value: T): void {
    const waiter = this.waiters.shift();
    if (waiter) waiter({ done: false, value });
    else this.values.push(value);
  }

  close(): void {
    this.closed = true;
    for (const waiter of this.waiters.splice(0)) waiter({ done: true, value: undefined });
  }

  async *[Symbol.asyncIterator](): AsyncGenerator<T> {
    while (true) {
      if (this.values.length > 0) yield this.values.shift() as T;
      else if (this.closed) return;
      else {
        const result = await new Promise<IteratorResult<T>>((resolve) => this.waiters.push(resolve));
        if (result.done) return;
        yield result.value;
      }
    }
  }
}

function createTransportPair(): {
  readonly client: RpcClientTransport;
  readonly server: RpcServerTransport;
  readonly close: () => void;
} {
  const toServer = new Channel<RpcClientFrame>();
  const toClient = new Channel<RpcServerFrame>();
  const close = (): void => {
    toServer.close();
    toClient.close();
  };
  return {
    client: { incoming: toClient, send: (frame) => toServer.send(frame), close },
    server: { incoming: toServer, send: (frame) => toClient.send(frame), close },
    close,
  };
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

describe("Stream RPC core", () => {
  it("routes and validates a complete agent stream", async () => {
    const pair = createTransportPair();
    const router = new StreamRpcRouter();
    router.register(agentTurnMethod, async function* (input) {
      expect(input.text).toBe("你好");
      yield { type: "started", turnId: "turn-1" };
      yield { type: "text-delta", text: "你好！" };
      yield { type: "completed" };
    });
    const server = new StreamRpcServer(pair.server, router);
    const serving = server.serve();
    const client = new StreamRpcClient(pair.client, () => "rpc-1");

    await expect(collect(client.stream(agentTurnMethod, {
      sessionId: "session-1",
      requestId: "request-1",
      text: "你好",
    }))).resolves.toEqual([
      { type: "started", turnId: "turn-1" },
      { type: "text-delta", text: "你好！" },
      { type: "completed" },
    ]);

    pair.close();
    await serving;
    await client.dispose();
  });

  it("propagates client cancellation to the server AbortSignal", async () => {
    const pair = createTransportPair();
    const router = new StreamRpcRouter();
    let observedAbort!: () => void;
    const aborted = new Promise<void>((resolve) => { observedAbort = resolve; });
    router.register(agentTurnMethod, async function* (_input, signal) {
      yield { type: "started", turnId: "turn-2" };
      await new Promise<void>((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
      observedAbort();
      yield { type: "cancelled" };
    });
    const server = new StreamRpcServer(pair.server, router);
    const serving = server.serve();
    const client = new StreamRpcClient(pair.client, () => "rpc-2");
    const controller = new AbortController();
    const stream = client.stream(agentTurnMethod, {
      sessionId: "session-1",
      requestId: "request-2",
      text: "停止",
    }, { signal: controller.signal });
    const iterator = stream[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toMatchObject({ value: { type: "started" } });
    controller.abort();
    await expect(iterator.next()).rejects.toMatchObject({ code: "cancelled" });
    await aborted;

    pair.close();
    await serving;
    await client.dispose();
  });

  it("sends cancellation only after an in-flight open frame is delivered", async () => {
    const incoming = new Channel<RpcServerFrame>();
    const openStarted = Promise.withResolvers<void>();
    const releaseOpen = Promise.withResolvers<void>();
    const frames: RpcClientFrame[] = [];
    const client = new StreamRpcClient({
      incoming,
      async send(frame) {
        frames.push(frame);
        if (frame.type === "open") {
          openStarted.resolve();
          await releaseOpen.promise;
        }
      },
      close: () => incoming.close(),
    }, () => "rpc-ordered-cancel");
    const controller = new AbortController();
    const iterator = client.stream(agentTurnMethod, {
      sessionId: "session-1",
      requestId: "request-ordered-cancel",
      text: "cancel while opening",
    }, { signal: controller.signal })[Symbol.asyncIterator]();

    const pending = iterator.next();
    await openStarted.promise;
    controller.abort();
    await Promise.resolve();
    expect(frames.map((frame) => frame.type)).toEqual(["open"]);

    releaseOpen.resolve();
    await expect(pending).rejects.toMatchObject({ code: "cancelled" });
    expect(frames.map((frame) => frame.type)).toEqual(["open", "cancel"]);
    await client.dispose();
  });

  it("waits for active handlers to settle before closing the server transport", async () => {
    const pair = createTransportPair();
    const router = new StreamRpcRouter();
    const entered = Promise.withResolvers<void>();
    const observedAbort = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    router.register(agentTurnMethod, async function* (_input, signal) {
      entered.resolve();
      yield { type: "started", turnId: "turn-drain" };
      if (!signal.aborted) {
        await new Promise<void>((resolve) =>
          signal.addEventListener("abort", () => resolve(), { once: true }));
      }
      observedAbort.resolve();
      await release.promise;
      yield { type: "cancelled" };
    });
    const server = new StreamRpcServer(pair.server, router);
    const serving = server.serve();
    await pair.client.send({
      version: 1,
      type: "open",
      id: "rpc-drain",
      method: "agent.turn",
      params: { sessionId: "session-1", requestId: "request-drain", text: "drain" },
    });
    await entered.promise;

    let disposed = false;
    const disposing = server.dispose().then(() => { disposed = true; });
    await observedAbort.promise;
    await Promise.resolve();
    expect(disposed).toBe(false);

    release.resolve();
    await disposing;
    expect(disposed).toBe(true);
    await serving;
  });

  it("returns a safe remote error for unknown methods", async () => {
    const pair = createTransportPair();
    const server = new StreamRpcServer(pair.server, new StreamRpcRouter());
    const serving = server.serve();
    const client = new StreamRpcClient(pair.client, () => "rpc-3");
    const unknown: RpcMethod<{ readonly ok: true }, unknown> = {
      name: "missing.stream",
      parseInput: (value: unknown) => value as { readonly ok: true },
      parseOutput: (value: unknown) => value,
    };

    await expect(collect(client.stream(unknown, { ok: true } as const))).rejects.toMatchObject({
      code: "remote-error",
      failure: { code: "method-not-found" },
    });

    pair.close();
    await serving;
    await client.dispose();
  });
});
