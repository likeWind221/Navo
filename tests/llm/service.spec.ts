import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import type { StreamChunk } from "../../src/llm/types.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import { LLMService } from "../../src/llm/service.js";
import {
  collect,
  createLLMTestKit,
  request,
  textStream,
} from "../helpers/llm.js";

const kit = createLLMTestKit();
afterEach(() => kit.dispose());

describe("LLMService routing", () => {
  it("forwards the adapter stream without changing chunk order", async () => {
    const ctx = await kit.createContext();
    const controller = new AbortController();
    const adapter = new MockLLMAdapter([
      { kind: "chunks", chunks: textStream },
    ]);
    ctx.llm.registerAdapter("mock", adapter);

    expect(await collect(ctx.llm.stream(request("mock", controller.signal))))
      .toEqual(textStream);
    expect(adapter.requests).toHaveLength(1);
    expect(adapter.requests[0]?.provider).toBe("mock");
    expect(adapter.requests[0]?.signal).toBe(controller.signal);
    expect(adapter.remainingEntries).toBe(0);
  });

  it("keeps a started stream bound to its original adapter", async () => {
    const ctx = await kit.createContext();
    const oldAdapter = new MockLLMAdapter([{
      kind: "chunks",
      chunks: textStream,
    }]);
    const disposeOld = ctx.llm.registerAdapter("route", oldAdapter);
    const iterator = ctx.llm.stream(request("route"))[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: textStream[0],
    });
    disposeOld();
    const replacement = new MockLLMAdapter([{
      kind: "chunks",
      chunks: [{ type: "finish", reason: { kind: "max-tokens" } }],
    }]);
    ctx.llm.registerAdapter("route", replacement);

    const remaining: StreamChunk[] = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      remaining.push(next.value);
    }
    expect(remaining).toEqual(textStream.slice(1));
    expect(replacement.requests).toHaveLength(0);
    expect(await collect(ctx.llm.stream(request("route")))).toEqual([
      { type: "finish", reason: { kind: "max-tokens" } },
    ]);
  });
});

describe("LLM adapter registration lifecycle", () => {
  it("rejects duplicates, disposes idempotently, and permits re-registration", async () => {
    const ctx = await kit.createContext();
    const first = new MockLLMAdapter([{ kind: "chunks", chunks: textStream }]);
    const dispose = ctx.llm.registerAdapter("mock", first);

    expect(() => ctx.llm.registerAdapter("mock", first)).toThrow(
      expect.objectContaining({ code: "adapter-already-registered" }),
    );
    dispose();
    dispose();
    const second = new MockLLMAdapter([{ kind: "chunks", chunks: textStream }]);
    expect(() => ctx.llm.registerAdapter("mock", second)).not.toThrow();
  });

  it("withdraws a registration with its owning plugin", async () => {
    const ctx = await kit.createContext();
    const adapter = new MockLLMAdapter([{ kind: "chunks", chunks: textStream }]);
    const owner = await ctx.plugin(Object.assign(
      (inner: Context) => inner.llm.registerAdapter("scoped", adapter),
      { inject: ["llm"] },
    ));

    expect(await collect(ctx.llm.stream(request("scoped")))).toEqual(textStream);
    await owner.dispose();
    expect((await collect(ctx.llm.stream(request("scoped"))))[0]).toMatchObject({
      type: "finish",
      reason: { kind: "error", failure: { code: "adapter-not-found" } },
    });
  });

  it("releases the Cordis service with its fiber", async () => {
    const ctx = new Context();
    kit.track(ctx);
    const fiber = await ctx.plugin(LLMService);

    expect(ctx.llm).toBeInstanceOf(LLMService);
    await fiber.dispose();
    expect(Reflect.get(ctx, "llm")).toBeUndefined();
  });
});

describe("MockLLMAdapter scripts", () => {
  it("emits a prefix before normalizing a scripted error", async () => {
    const ctx = await kit.createContext();
    const prefix: StreamChunk[] = [
      { type: "block-start", index: 0, blockType: "reasoning" },
      { type: "reasoning-delta", index: 0, text: "thinking" },
    ];
    ctx.llm.registerAdapter("mock", new MockLLMAdapter([{
      kind: "error",
      chunksBeforeError: prefix,
      error: new Error("provider disconnected"),
    }]));

    const chunks = await collect(ctx.llm.stream(request("mock")));
    expect(chunks.slice(0, 2)).toEqual(prefix);
    expect(chunks[2]).toEqual({
      type: "finish",
      reason: {
        kind: "error",
        failure: { code: "stream-failed", message: "provider disconnected" },
      },
    });
  });

  it("reports queue exhaustion as a terminal stream failure", async () => {
    const ctx = await kit.createContext();
    const adapter = new MockLLMAdapter([{ kind: "chunks", chunks: textStream }]);
    ctx.llm.registerAdapter("mock", adapter);

    await collect(ctx.llm.stream(request("mock")));
    expect(await collect(ctx.llm.stream(request("mock")))).toEqual([{
      type: "finish",
      reason: {
        kind: "error",
        failure: {
          code: "stream-failed",
          message: "Mock LLM stream queue is exhausted.",
        },
      },
    }]);
  });
});
