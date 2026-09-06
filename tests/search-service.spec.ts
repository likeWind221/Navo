import { Context } from "cordis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MockSearchAdapter } from "../src/tools/builtins/search/adapters/mock.js";
import { SearchError } from "../src/tools/builtins/search/errors.js";
import { SearchService } from "../src/tools/builtins/search/service.js";
import type { SearchAdapter, SearchResult } from "../src/tools/builtins/search/types.js";

const contexts = new Set<Context>();
const empty: SearchResult = { sources: [], truncated: false };

async function createSearch(config: ConstructorParameters<typeof SearchService>[1] = {}) {
  const ctx = new Context();
  contexts.add(ctx);
  await ctx.plugin(SearchService, config);
  return ctx;
}

afterEach(async () => {
  await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
  contexts.clear();
});

describe("SearchService registration and routing", () => {
  it("selects the sole adapter and normalizes a detached request", async () => {
    const ctx = await createSearch();
    const adapter = new MockSearchAdapter([{ kind: "result", result: empty }]);
    ctx.search.registerAdapter(adapter);
    const request = { query: "  TypeScript agents  " };

    await expect(ctx.search.search(request)).resolves.toEqual(empty);

    expect(adapter.requests).toEqual([{ query: "TypeScript agents", maxResults: 8 }]);
    expect(Object.isFrozen(adapter.requests[0])).toBe(true);
    expect(request).toEqual({ query: "  TypeScript agents  " });
  });

  it("uses an explicit default independent of registration order", async () => {
    const ctx = await createSearch({ defaultProvider: "chosen" });
    const other = new MockSearchAdapter([], "other");
    const chosen = new MockSearchAdapter([{ kind: "result", result: empty }], "chosen");
    ctx.search.registerAdapter(other);
    ctx.search.registerAdapter(chosen);

    await ctx.search.search({ query: "route" });

    expect(chosen.requests).toHaveLength(1);
    expect(other.requests).toHaveLength(0);
  });

  it("classifies unavailable, ambiguous, missing, duplicate, and invalid adapters", async () => {
    const none = await createSearch();
    await expect(none.search.search({ query: "q" })).rejects.toMatchObject({ code: "provider-unavailable" });
    none.search.registerAdapter(new MockSearchAdapter([], "one"));
    expect(() => none.search.registerAdapter(new MockSearchAdapter([], "one")))
      .toThrow(expect.objectContaining({ code: "adapter-already-registered" }));
    none.search.registerAdapter(new MockSearchAdapter([], "two"));
    expect(() => none.search.resolveAdapter()).toThrow(expect.objectContaining({ code: "provider-ambiguous" }));
    expect(() => none.search.registerAdapter({ id: "Bad ID" } as SearchAdapter))
      .toThrow(expect.objectContaining({ code: "invalid-adapter" }));

    const missing = await createSearch({ defaultProvider: "missing" });
    expect(() => missing.search.resolveAdapter()).toThrow(expect.objectContaining({ code: "adapter-not-found" }));
  });

  it("unregisters with its owner fiber and keeps disposal idempotent", async () => {
    const ctx = await createSearch();
    let unregister: (() => void) | undefined;
    const owner = await ctx.plugin(Object.assign(
      (ownerCtx: Context) => {
        unregister = ownerCtx.search.registerAdapter(new MockSearchAdapter([], "owned"));
      },
      { inject: ["search"] },
    ));
    expect(ctx.search.resolveAdapter().id).toBe("owned");

    await owner.dispose();
    unregister?.();

    expect(() => ctx.search.resolveAdapter()).toThrow(expect.objectContaining({ code: "provider-unavailable" }));
  });
});

describe("SearchService execution boundary", () => {
  it("caps, truncates, copies, and deeply freezes accepted output", async () => {
    const raw = {
      sources: [
        { title: " First ", url: "https://one.test", summary: " Summary " },
        { title: "Second", url: "https://two.test", summary: "Two" },
      ],
      truncated: false,
    };
    const ctx = await createSearch();
    ctx.search.registerAdapter({ id: "raw", search: async () => raw });

    const result = await ctx.search.search({ query: "q", maxResults: 1 });
    raw.sources[0]!.title = "mutated";

    expect(result).toEqual({
      sources: [{ title: "First", url: "https://one.test", summary: "Summary" }],
      truncated: true,
    });
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.sources)).toBe(true);
    expect(Object.isFrozen(result.sources[0])).toBe(true);
  });

  it.each([
    [{ query: "" }, "invalid-request"],
    [{ query: "q", maxResults: 0 }, "invalid-request"],
    [{ query: "q", maxResults: 1.5 }, "invalid-request"],
  ])("rejects invalid request %# before adapter execution", async (request, code) => {
    const ctx = await createSearch();
    const search = vi.fn(async () => empty);
    ctx.search.registerAdapter({ id: "spy", search });

    await expect(ctx.search.search(request)).rejects.toMatchObject({ code });
    expect(search).not.toHaveBeenCalled();
  });

  it("rejects malformed retained sources but ignores malformed discarded sources", async () => {
    const ctx = await createSearch();
    const malformed = { title: "Bad", url: "file:///secret", summary: "bad" };
    ctx.search.registerAdapter(new MockSearchAdapter([
      { kind: "result", result: { sources: [malformed], truncated: false } },
      { kind: "result", result: {
        sources: [{ title: "Good", url: "https://good.test", summary: "ok" }, malformed],
        truncated: false,
      } },
    ]));

    await expect(ctx.search.search({ query: "bad" })).rejects.toMatchObject({ code: "invalid-response" });
    await expect(ctx.search.search({ query: "bounded", maxResults: 1 })).resolves.toMatchObject({
      sources: [{ url: "https://good.test" }], truncated: true,
    });
  });

  it("preserves classified failures and hides unknown adapter exceptions", async () => {
    const classified = await createSearch();
    classified.search.registerAdapter(new MockSearchAdapter([{
      kind: "error",
      error: new SearchError("invalid-response", "private provider body"),
    }]));
    await expect(classified.search.search({ query: "q" })).rejects.toMatchObject({
      code: "invalid-response", modelMessage: "The search provider returned an invalid response.",
    });

    const unknown = await createSearch();
    unknown.search.registerAdapter(new MockSearchAdapter([{
      kind: "error", error: new Error("token=secret"),
    }]));
    const error = await unknown.search.search({ query: "q" }).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "request-failed", modelMessage: "The search request failed." });
    expect((error as Error).message).not.toContain("secret");
  });

  it("does not start when pre-cancelled", async () => {
    const ctx = await createSearch();
    const search = vi.fn(async () => empty);
    ctx.search.registerAdapter({ id: "spy", search });
    const controller = new AbortController();
    controller.abort();

    await expect(ctx.search.search({ query: "q" }, controller.signal))
      .rejects.toMatchObject({ code: "aborted" });
    expect(search).not.toHaveBeenCalled();
  });

  it("separates caller cancellation from timeout and aborts adapter work", async () => {
    const cancelled = await createSearch({ timeoutMs: 1_000 });
    const cancelAdapter = new MockSearchAdapter([{ kind: "hang" }]);
    cancelled.search.registerAdapter(cancelAdapter);
    const controller = new AbortController();
    const pendingCancel = cancelled.search.search({ query: "cancel" }, controller.signal);
    controller.abort();
    await expect(pendingCancel).rejects.toMatchObject({ code: "aborted" });

    const timed = await createSearch({ timeoutMs: 5 });
    let adapterSignal: AbortSignal | undefined;
    timed.search.registerAdapter({
      id: "hanging",
      search: async (_request, signal) => {
        adapterSignal = signal;
        return new Promise<SearchResult>(() => undefined);
      },
    });
    await expect(timed.search.search({ query: "timeout" }))
      .rejects.toMatchObject({ code: "timeout" });
    expect(adapterSignal?.aborted).toBe(true);
  });
});
