import { describe, expect, it, vi } from "vitest";

import { ExaSearchAdapter } from "../src/tools/builtins/search/adapters/exa.js";
import { EXA_MAX_RESPONSE_BYTES } from "../src/tools/builtins/search/adapters/exa-response.js";

function jsonResponse(value: unknown, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  if (!headers.has("content-type")) headers.set("content-type", "application/json; charset=utf-8");
  return new Response(JSON.stringify(value), { ...init, headers });
}

describe("ExaSearchAdapter request protocol", () => {
  it("uses the fixed endpoint, trusted key, bounded request shape, and caller signal", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => jsonResponse({
      results: [{
        url: "https://result.test/article",
        title: "Result",
        highlights: ["  useful excerpt  "],
        publishedDate: "2026-09-03T10:30:00Z",
      }],
    }));
    const adapter = new ExaSearchAdapter({ apiKey: "trusted-key" }, fetchMock);
    const controller = new AbortController();

    await expect(adapter.search({ query: "  agent planning  ", maxResults: 3 }, controller.signal))
      .resolves.toEqual({
        sources: [{
          url: "https://result.test/article",
          title: "Result",
          summary: "useful excerpt",
          publishedAt: "2026-09-03T10:30:00Z",
        }],
        truncated: false,
      });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.exa.ai/search");
    expect(init).toMatchObject({ method: "POST", redirect: "error", signal: controller.signal });
    const headers = new Headers(init?.headers);
    expect(headers.get("x-api-key")).toBe("trusted-key");
    expect(headers.get("authorization")).toBeNull();
    expect(JSON.parse(String(init?.body))).toEqual({
      query: "agent planning",
      type: "auto",
      numResults: 3,
      contents: { highlights: { maxCharacters: 2000 } },
    });
  });

  it("rejects invalid credentials without issuing HTTP requests", () => {
    const fetchMock = vi.fn<typeof fetch>();
    expect(() => new ExaSearchAdapter({ apiKey: " \n" }, fetchMock))
      .toThrow(expect.objectContaining({ code: "invalid-config" }));
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("does not leak transport diagnostics or credentials", async () => {
    const fetchMock = vi.fn<typeof fetch>(async () => {
      throw new Error("proxy echoed trusted-key");
    });
    const adapter = new ExaSearchAdapter({ apiKey: "trusted-key" }, fetchMock);

    const error = await adapter.search({ query: "q" }).catch((value: unknown) => value);

    expect(error).toMatchObject({ code: "request-failed", modelMessage: "The search request failed." });
    expect((error as Error).message).not.toContain("trusted-key");
    expect((error as Error).cause).toBeUndefined();
  });
});

describe("ExaSearchAdapter response boundary", () => {
  it("drops snippet-less results, defaults blank titles, and omits date-only values", async () => {
    const adapter = new ExaSearchAdapter({ apiKey: "key" }, async () => jsonResponse({
      results: [
        { url: "https://drop.test", title: "Drop", highlights: [" "] },
        { url: "https://keep.test", title: " ", highlights: ["summary"], publishedDate: "2026-09-03" },
      ],
    }));

    await expect(adapter.search({ query: "q" })).resolves.toEqual({
      sources: [{ title: "https://keep.test", url: "https://keep.test", summary: "summary" }],
      truncated: true,
    });
  });

  it.each([
    ["HTTP error", async () => jsonResponse({ secret: "body" }, { status: 429 }), "request-failed"],
    ["wrong content type", async () => new Response("text", { headers: { "content-type": "text/plain" } }), "invalid-response"],
    ["malformed JSON", async () => new Response("{", { headers: { "content-type": "application/json" } }), "invalid-response"],
    ["invalid vendor envelope", async () => jsonResponse({ results: "wrong" }), "invalid-response"],
    ["invalid source", async () => jsonResponse({ results: [{ url: "file:///x", highlights: ["x"] }] }), "invalid-response"],
  ])("classifies %s", async (_label, fetchImplementation, code) => {
    const adapter = new ExaSearchAdapter({ apiKey: "key" }, fetchImplementation as typeof fetch);
    await expect(adapter.search({ query: "q" })).rejects.toMatchObject({ code });
  });

  it("rejects redirected responses even when status is successful", async () => {
    const response = jsonResponse({ results: [] });
    Object.defineProperty(response, "redirected", { value: true });
    const adapter = new ExaSearchAdapter({ apiKey: "key" }, async () => response);

    await expect(adapter.search({ query: "q" })).rejects.toMatchObject({ code: "request-failed" });
  });

  it("rejects declared and streamed bodies above the five MiB limit", async () => {
    const declared = new ExaSearchAdapter({ apiKey: "key" }, async () => new Response("{}", {
      headers: {
        "content-type": "application/json",
        "content-length": String(EXA_MAX_RESPONSE_BYTES + 1),
      },
    }));
    await expect(declared.search({ query: "q" })).rejects.toMatchObject({ code: "response-too-large" });

    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new Uint8Array(EXA_MAX_RESPONSE_BYTES + 1));
        controller.close();
      },
    });
    const streamed = new ExaSearchAdapter({ apiKey: "key" }, async () => new Response(stream, {
      headers: { "content-type": "application/json" },
    }));
    await expect(streamed.search({ query: "q" })).rejects.toMatchObject({ code: "response-too-large" });
  });

  it("propagates cancellation as aborted and never starts a pre-cancelled request", async () => {
    const fetchMock = vi.fn<typeof fetch>((_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("cancelled", "AbortError")), { once: true });
    }));
    const adapter = new ExaSearchAdapter({ apiKey: "key" }, fetchMock);
    const running = new AbortController();
    const pending = adapter.search({ query: "q" }, running.signal);
    running.abort();
    await expect(pending).rejects.toMatchObject({ code: "aborted" });

    const preCancelled = new AbortController();
    preCancelled.abort();
    await expect(adapter.search({ query: "q" }, preCancelled.signal))
      .rejects.toMatchObject({ code: "aborted" });
    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
