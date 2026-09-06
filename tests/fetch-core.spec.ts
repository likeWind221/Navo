import { describe, expect, it, vi } from "vitest";

import { FetchCore } from "../src/tools/builtins/fetch/core.js";
import { FetchError } from "../src/tools/builtins/fetch/errors.js";
import type { FetchResult } from "../src/tools/builtins/fetch/types.js";

const result: FetchResult = {
  url: "https://example.test/article",
  statusCode: 200,
  body: { kind: "text", format: "plain", content: "body" },
};

describe("FetchCore validation", () => {
  it("normalizes detached requests and rejects incomplete oversized results", async () => {
    const operation = vi.fn(async () => ({
      ...result,
      body: { ...result.body, content: "abcdef" },
    }));
    const core = new FetchCore(operation, { maxBodyCharacters: 3 });
    const request = { url: " https://example.test/article " };

    await expect(core.fetch(request)).rejects.toMatchObject({
      code: "response-too-large",
    });

    expect(operation).toHaveBeenCalledWith(
      { url: "https://example.test/article" },
      expect.any(AbortSignal),
    );
    expect(request.url).toContain(" ");

    const complete = await new FetchCore(async () => result, { maxBodyCharacters: 4 })
      .fetch({ url: "https://example.test/article" });
    expect(complete).toEqual(result);
    expect(Object.isFrozen(complete)).toBe(true);
    expect(Object.isFrozen(complete.body)).toBe(true);
  });

  it("rejects invalid config, request URLs, and result shapes", async () => {
    expect(() => new FetchCore(async () => result, { timeoutMs: 0 }))
      .toThrow(expect.objectContaining({ code: "invalid-config" }));
    const core = new FetchCore(async () => result);
    await expect(core.fetch({ url: "file:///secret" }))
      .rejects.toMatchObject({ code: "invalid-url" });
    await expect(new FetchCore(async () => ({ ...result, statusCode: 700 }))
      .fetch({ url: "https://example.test" }))
      .rejects.toMatchObject({ code: "invalid-response" });
  });

  it("preserves classified errors and hides unknown operation failures", async () => {
    const classified = new FetchCore(async () => {
      throw new FetchError("blocked-url", "private address 127.0.0.1");
    });
    await expect(classified.fetch({ url: "https://example.test" }))
      .rejects.toMatchObject({
        code: "blocked-url",
        modelMessage: "The requested URL is not allowed by network policy.",
      });

    const unknown = new FetchCore(async () => { throw new Error("token=secret"); });
    const error = await unknown.fetch({ url: "https://example.test" })
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: "network-failed",
      modelMessage: "The web fetch request failed.",
    });
    expect((error as Error).message).not.toContain("secret");
  });
});

describe("FetchCore cancellation and timeout", () => {
  it("does not start a pre-cancelled operation", async () => {
    const operation = vi.fn(async () => result);
    const controller = new AbortController();
    controller.abort();

    await expect(new FetchCore(operation).fetch(
      { url: "https://example.test" },
      controller.signal,
    )).rejects.toMatchObject({ code: "aborted" });
    expect(operation).not.toHaveBeenCalled();
  });

  it("aborts operation work on caller cancellation", async () => {
    let innerSignal: AbortSignal | undefined;
    const core = new FetchCore(async (_request, signal) => {
      innerSignal = signal;
      return await new Promise(() => undefined);
    });
    const controller = new AbortController();
    const pending = core.fetch({ url: "https://example.test" }, controller.signal);

    controller.abort();

    await expect(pending).rejects.toMatchObject({ code: "aborted" });
    expect(innerSignal?.aborted).toBe(true);
  });

  it("classifies its own deadline and ignores a late result", async () => {
    let innerSignal: AbortSignal | undefined;
    const late = Promise.withResolvers<FetchResult>();
    const core = new FetchCore(async (_request, signal) => {
      innerSignal = signal;
      return await late.promise;
    }, { timeoutMs: 5 });

    await expect(core.fetch({ url: "https://example.test" }))
      .rejects.toMatchObject({ code: "timeout" });
    expect(innerSignal?.aborted).toBe(true);
    late.resolve(result);
    await Promise.resolve();
  });
});
