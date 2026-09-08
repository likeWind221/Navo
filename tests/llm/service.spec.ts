import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import type { ModelEvent } from "../../src/llm/types.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import { LLMService } from "../../src/llm/service.js";
import {
  collect,
  createLLMTestKit,
  request,
  textEvents,
} from "../helpers/llm.js";

const kit = createLLMTestKit();
afterEach(() => kit.dispose());

describe("LLMService routing", () => {
  it("forwards the adapter stream without changing event order", async () => {
    const ctx = await kit.createContext();
    const controller = new AbortController();
    const adapter = new MockLLMAdapter([
      { kind: "events", events: textEvents },
    ]);
    ctx.llm.registerAdapter("mock", adapter);

    expect(await collect(ctx.llm.stream(request("mock", controller.signal))))
      .toEqual(textEvents);
    expect(adapter.requests).toHaveLength(1);
    expect(adapter.requests[0]?.provider).toBe("mock");
    expect(adapter.requests[0]?.signal).toBe(controller.signal);
    expect(adapter.remainingEntries).toBe(0);
  });

  it("keeps a started stream bound to its original adapter", async () => {
    const ctx = await kit.createContext();
    const oldAdapter = new MockLLMAdapter([{
      kind: "events",
      events: textEvents,
    }]);
    const disposeOld = ctx.llm.registerAdapter("route", oldAdapter);
    const iterator = ctx.llm.stream(request("route"))[Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: textEvents[0],
    });
    disposeOld();
    const replacement = new MockLLMAdapter([{
      kind: "events",
      events: [{ type: "finished", reason: { kind: "max-tokens" } }],
    }]);
    ctx.llm.registerAdapter("route", replacement);

    const remaining: ModelEvent[] = [];
    while (true) {
      const next = await iterator.next();
      if (next.done) break;
      remaining.push(next.value);
    }
    expect(remaining).toEqual(textEvents.slice(1));
    expect(replacement.requests).toHaveLength(0);
    expect(await collect(ctx.llm.stream(request("route")))).toEqual([
      { type: "finished", reason: { kind: "max-tokens" } },
    ]);
  });
});

describe("LLM adapter registration lifecycle", () => {
  it("rejects duplicates, disposes idempotently, and permits re-registration", async () => {
    const ctx = await kit.createContext();
    const first = new MockLLMAdapter([{ kind: "events", events: textEvents }]);
    const dispose = ctx.llm.registerAdapter("mock", first);

    expect(() => ctx.llm.registerAdapter("mock", first)).toThrow(
      expect.objectContaining({ code: "adapter-already-registered" }),
    );
    dispose();
    dispose();
    const second = new MockLLMAdapter([{ kind: "events", events: textEvents }]);
    expect(() => ctx.llm.registerAdapter("mock", second)).not.toThrow();
  });

  it("withdraws a registration with its owning plugin", async () => {
    const ctx = await kit.createContext();
    const adapter = new MockLLMAdapter([{ kind: "events", events: textEvents }]);
    const owner = await ctx.plugin(Object.assign(
      (inner: Context) => inner.llm.registerAdapter("scoped", adapter),
      { inject: ["llm"] },
    ));

    expect(await collect(ctx.llm.stream(request("scoped")))).toEqual(textEvents);
    await owner.dispose();
    expect((await collect(ctx.llm.stream(request("scoped"))))[0]).toMatchObject({
      type: "finished",
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
    const prefix: ModelEvent[] = [
      { type: "content-started", contentIndex: 0, contentType: "reasoning" },
      { type: "content-delta", contentIndex: 0, contentType: "reasoning", delta: "thinking" },
    ];
    ctx.llm.registerAdapter("mock", new MockLLMAdapter([{
      kind: "error",
      eventsBeforeError: prefix,
      error: new Error("provider disconnected"),
    }]));

    const events = await collect(ctx.llm.stream(request("mock")));
    expect(events.slice(0, 2)).toEqual(prefix);
    expect(events[2]).toEqual({
      type: "finished",
      reason: {
        kind: "error",
        failure: { code: "stream-failed", message: "provider disconnected" },
      },
    });
  });

  it("reports queue exhaustion as a terminal stream failure", async () => {
    const ctx = await kit.createContext();
    const adapter = new MockLLMAdapter([{ kind: "events", events: textEvents }]);
    ctx.llm.registerAdapter("mock", adapter);

    await collect(ctx.llm.stream(request("mock")));
    expect(await collect(ctx.llm.stream(request("mock")))).toEqual([{
      type: "finished",
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
