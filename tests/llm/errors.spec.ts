import { afterEach, describe, expect, it } from "vitest";

import type { StreamChunk } from "../../src/llm/types.js";
import type { LLMAdapter } from "../../src/llm/adapter.js";
import {
  collect,
  createLLMTestKit,
  request,
} from "../helpers/llm.js";

const kit = createLLMTestKit();
afterEach(() => kit.dispose());

describe("LLMService adapter errors", () => {
  it("normalizes a missing provider to a terminal error finish", async () => {
    const ctx = await kit.createContext();

    await expect(collect(ctx.llm.stream(request("missing")))).resolves.toEqual([
      {
        type: "finish",
        reason: {
          kind: "error",
          failure: {
            code: "adapter-not-found",
            message: expect.stringContaining("missing"),
          },
        },
      },
    ]);
  });

  it("normalizes dispatch, iterator construction, and next failures", async () => {
    const ctx = await kit.createContext();
    const dispatchFailure: LLMAdapter = {
      stream() {
        throw new Error("dispatch failed");
      },
    };
    const iteratorFailure: LLMAdapter = {
      stream: () => ({
        [Symbol.asyncIterator]() {
          throw new Error("iterator failed");
        },
      }),
    };
    const nextFailure: LLMAdapter = {
      stream: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject("plain provider failure"),
        }),
      }),
    };

    ctx.llm.registerAdapter("dispatch", dispatchFailure);
    ctx.llm.registerAdapter("iterator", iteratorFailure);
    ctx.llm.registerAdapter("next", nextFailure);

    for (const [provider, message] of [
      ["dispatch", "dispatch failed"],
      ["iterator", "iterator failed"],
      ["next", "plain provider failure"],
    ] as const) {
      expect(await collect(ctx.llm.stream(request(provider)))).toEqual([{
        type: "finish",
        reason: {
          kind: "error",
          failure: { code: "stream-failed", message },
        },
      }]);
    }
  });

  it("keeps a provider AbortError distinct from caller cancellation", async () => {
    const ctx = await kit.createContext();
    const providerFailure = new DOMException(
      "provider request timed out",
      "AbortError",
    );
    ctx.llm.registerAdapter("provider-abort", {
      stream: () => ({
        [Symbol.asyncIterator]: () => ({
          next: () => Promise.reject(providerFailure),
        }),
      }),
    });

    await expect(
      collect(ctx.llm.stream(request("provider-abort"))),
    ).resolves.toEqual([{
      type: "finish",
      reason: {
        kind: "error",
        failure: {
          code: "stream-failed",
          message: "provider request timed out",
        },
      },
    }]);
  });

  it.each(["done", "value"] as const)(
    "normalizes a throwing IteratorResult.%s getter without cleanup",
    async (field) => {
      const ctx = await kit.createContext();
      let cleanupLookups = 0;
      const result = field === "done" ? {} : { done: false };
      Object.defineProperty(result, field, {
        get: () => {
          throw new Error(`${field} getter failed`);
        },
      });
      const iterator: AsyncIterator<StreamChunk> = {
        next: () => Promise.resolve(
          result as unknown as IteratorResult<StreamChunk>,
        ),
      };
      Object.defineProperty(iterator, "return", {
        get: () => {
          cleanupLookups += 1;
          throw new Error("cleanup must not run after iterator failure");
        },
      });
      ctx.llm.registerAdapter("getter", {
        stream: () => ({ [Symbol.asyncIterator]: () => iterator }),
      });

      await expect(collect(ctx.llm.stream(request("getter")))).resolves.toEqual([
        {
          type: "finish",
          reason: {
            kind: "error",
            failure: {
              code: "stream-failed",
              message: `${field} getter failed`,
            },
          },
        },
      ]);
      expect(cleanupLookups).toBe(0);
    },
  );
});
