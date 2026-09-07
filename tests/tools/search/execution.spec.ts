import { describe, expect, it, vi } from "vitest";

import { MockSearchAdapter } from "../../../src/tools/builtins/search/adapters/mock.js";
import { SearchError } from "../../../src/tools/builtins/search/errors.js";
import { executeSearch } from "../../../src/tools/builtins/search/execution.js";
import type { SearchResult } from "../../../src/tools/builtins/search/types.js";

const empty: SearchResult = { sources: [], truncated: false };

describe("search execution boundary", () => {
  it("normalizes a detached request before executing one fixed adapter", async () => {
    const adapter = new MockSearchAdapter([{ kind: "result", result: empty }]);
    const request = { query: "  TypeScript agents  " };

    await expect(executeSearch(adapter, request)).resolves.toEqual(empty);

    expect(adapter.requests).toEqual([
      { query: "TypeScript agents", maxResults: 8 },
    ]);
    expect(Object.isFrozen(adapter.requests[0])).toBe(true);
    expect(request).toEqual({ query: "  TypeScript agents  " });
  });

  it("rejects absent and malformed construction-time adapters", async () => {
    await expect(executeSearch(undefined, { query: "q" }))
      .rejects.toMatchObject({ code: "provider-unavailable" });
    await expect(executeSearch({ id: "Bad ID" } as never, { query: "q" }))
      .rejects.toMatchObject({ code: "invalid-adapter" });
  });

  it("caps, truncates, copies, and deeply freezes accepted output", async () => {
    const raw = {
      sources: [
        { title: " First ", url: "https://one.test", summary: " Summary " },
        { title: "Second", url: "https://two.test", summary: "Two" },
      ],
      truncated: false,
    };
    const adapter = { id: "raw", search: async () => raw };

    const result = await executeSearch(adapter, { query: "q", maxResults: 1 });
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
    const search = vi.fn(async () => empty);

    await expect(executeSearch({ id: "spy", search }, request))
      .rejects.toMatchObject({ code });
    expect(search).not.toHaveBeenCalled();
  });

  it("rejects malformed retained sources but ignores discarded sources", async () => {
    const malformed = { title: "Bad", url: "file:///secret", summary: "bad" };
    const adapter = new MockSearchAdapter([
      { kind: "result", result: { sources: [malformed], truncated: false } },
      { kind: "result", result: {
        sources: [
          { title: "Good", url: "https://good.test", summary: "ok" },
          malformed,
        ],
        truncated: false,
      } },
    ]);

    await expect(executeSearch(adapter, { query: "bad" }))
      .rejects.toMatchObject({ code: "invalid-response" });
    await expect(executeSearch(adapter, { query: "bounded", maxResults: 1 }))
      .resolves.toMatchObject({
        sources: [{ url: "https://good.test" }],
        truncated: true,
      });
  });

  it("preserves classified failures and hides unknown adapter exceptions", async () => {
    const classified = new MockSearchAdapter([{
      kind: "error",
      error: new SearchError("invalid-response", "private provider body"),
    }]);
    await expect(executeSearch(classified, { query: "q" }))
      .rejects.toMatchObject({
        code: "invalid-response",
        modelMessage: "The search provider returned an invalid response.",
      });

    const unknown = new MockSearchAdapter([{
      kind: "error",
      error: new Error("token=secret"),
    }]);
    const error = await executeSearch(unknown, { query: "q" })
      .catch((value: unknown) => value);
    expect(error).toMatchObject({
      code: "request-failed",
      modelMessage: "The search request failed.",
    });
    expect((error as Error).message).not.toContain("secret");
  });

  it("does not start when pre-cancelled", async () => {
    const search = vi.fn(async () => empty);
    const controller = new AbortController();
    controller.abort();

    await expect(executeSearch(
      { id: "spy", search },
      { query: "q" },
      { signals: [controller.signal] },
    )).rejects.toMatchObject({ code: "aborted" });
    expect(search).not.toHaveBeenCalled();
  });

  it("separates caller cancellation from timeout and aborts adapter work", async () => {
    const cancelAdapter = new MockSearchAdapter([{ kind: "hang" }]);
    const controller = new AbortController();
    const pendingCancel = executeSearch(
      cancelAdapter,
      { query: "cancel" },
      { timeoutMs: 1_000, signals: [controller.signal] },
    );
    controller.abort();
    await expect(pendingCancel).rejects.toMatchObject({ code: "aborted" });

    let adapterSignal: AbortSignal | undefined;
    const pendingTimeout = executeSearch({
      id: "hanging",
      search: async (_request, signal) => {
        adapterSignal = signal;
        return new Promise<SearchResult>(() => undefined);
      },
    }, { query: "timeout" }, { timeoutMs: 5 });
    await expect(pendingTimeout).rejects.toMatchObject({ code: "timeout" });
    expect(adapterSignal?.aborted).toBe(true);
  });
});
