import { afterEach, describe, expect, it, vi } from "vitest";

import type { ModelEvent } from "../../src/llm/types.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import type { LLMAdapter } from "../../src/llm/adapter.js";
import {
  collect,
  createLLMTestKit,
  request,
  textEvents,
} from "../helpers/llm.js";

const kit = createLLMTestKit();
afterEach(async () => {
  vi.useRealTimers();
  await kit.dispose();
});

describe("LLMService cancellation and cleanup", () => {
  it("keeps prefix events and finishes as cancelled on mid-stream abort", async () => {
    const ctx = await kit.createContext();
    const controller = new AbortController();
    const prefix: ModelEvent[] = [
      { type: "content-started", contentIndex: 0, contentType: "text" },
      { type: "content-delta", contentIndex: 0, contentType: "text", delta: "partial" },
    ];
    const adapter = new MockLLMAdapter([{
      kind: "hang",
      eventsBeforeHang: prefix,
    }]);
    ctx.llm.registerAdapter("mock", adapter);
    const iterator = ctx.llm
      .stream(request("mock", controller.signal))
      [Symbol.asyncIterator]();

    await expect(iterator.next()).resolves.toEqual({ done: false, value: prefix[0] });
    await expect(iterator.next()).resolves.toEqual({ done: false, value: prefix[1] });
    const pending = iterator.next();
    controller.abort("user cancelled");

    await expect(pending).resolves.toEqual({
      done: false,
      value: { type: "finished", reason: { kind: "cancelled" } },
    });
    await expect(iterator.next()).resolves.toEqual({ done: true, value: undefined });
  });

  it("does not start the adapter when already aborted", async () => {
    const ctx = await kit.createContext();
    const adapter = new MockLLMAdapter([{ kind: "events", events: textEvents }]);
    const signal = AbortSignal.abort("already cancelled");
    ctx.llm.registerAdapter("mock", adapter);

    await expect(collect(ctx.llm.stream(request("mock", signal)))).resolves.toEqual([
      { type: "finished", reason: { kind: "cancelled" } },
    ]);
    expect(adapter.requests).toHaveLength(0);
    expect(adapter.remainingEntries).toBe(1);
  });

  it("abandons an uncooperative pending next and observes cleanup", async () => {
    const ctx = await kit.createContext();
    const controller = new AbortController();
    let returnCalls = 0;
    const adapter: LLMAdapter = {
      stream: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => new Promise<IteratorResult<ModelEvent>>(() => undefined),
          return: () => {
            returnCalls += 1;
            return Promise.resolve({ done: true, value: undefined });
          },
        }),
      }),
    };
    ctx.llm.registerAdapter("stuck", adapter);
    const pending = collect(ctx.llm.stream(request("stuck", controller.signal)));

    controller.abort("stop waiting");
    const events = await Promise.race([
      pending,
      new Promise<never>((_resolve, reject) => {
        setTimeout(() => reject(new Error("abort did not settle promptly")), 100);
      }),
    ]);

    expect(events).toEqual([
      { type: "finished", reason: { kind: "cancelled" } },
    ]);
    expect(returnCalls).toBe(1);
  });

  it("awaits consumer cleanup and preserves cleanup failures", async () => {
    const ctx = await kit.createContext();
    const cleanupFailure = new Error("cleanup failed");
    let returnCalls = 0;
    const adapter: LLMAdapter = {
      stream: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.resolve({ done: false, value: textEvents[0]! }),
          return: () => {
            returnCalls += 1;
            return Promise.reject(cleanupFailure);
          },
        }),
      }),
    };
    ctx.llm.registerAdapter("cleanup", adapter);

    await expect((async () => {
      for await (const _chunk of ctx.llm.stream(request("cleanup"))) break;
    })()).rejects.toBe(cleanupFailure);
    expect(returnCalls).toBe(1);
  });

  it("clears a pending Mock chunk timer when aborted", async () => {
    vi.useFakeTimers();
    const ctx = await kit.createContext();
    const controller = new AbortController();
    const adapter = new MockLLMAdapter([{
      kind: "events",
      events: textEvents,
      eventDelayMs: 10_000,
    }]);
    ctx.llm.registerAdapter("slow", adapter);
    const pending = collect(ctx.llm.stream(request("slow", controller.signal)));
    await vi.advanceTimersByTimeAsync(0);

    expect(vi.getTimerCount()).toBeGreaterThan(0);
    controller.abort("cancel delay");
    await expect(pending).resolves.toEqual([
      { type: "finished", reason: { kind: "cancelled" } },
    ]);
    expect(vi.getTimerCount()).toBe(0);
  });
});
