import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Response } from "undici";

import { FetchError } from "../src/tools/builtins/fetch/errors.js";
import { createHttpFetch } from "../src/tools/builtins/fetch/http.js";
import { publicFetchNetwork } from "../src/tools/builtins/fetch/network.js";
import type { PinnedResponse } from "../src/tools/builtins/fetch/network.js";

const signal = new AbortController().signal;

beforeEach(() => {
  vi.spyOn(publicFetchNetwork, "resolve").mockResolvedValue([
    { address: "8.8.8.8", family: 4 },
  ]);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("HTTP Fetch response protocol", () => {
  it.each([
    ["text/html; charset=utf-8", "<h1>Hello</h1>", { kind: "html", content: "<h1>Hello</h1>" }],
    ["text/markdown", "# Hello", { kind: "text", format: "markdown", content: "# Hello" }],
    ["text/plain", "Hello", { kind: "text", format: "plain", content: "Hello" }],
  ])("classifies and decodes %s", async (contentType, content, expected) => {
    const close = mockRequest(new Response(content, {
      status: 200,
      headers: { "content-type": contentType },
    }));

    await expect(createHttpFetch()(
      { url: "https://example.test/article" },
      signal,
    )).resolves.toMatchObject({
      url: "https://example.test/article",
      statusCode: 200,
      body: expected,
    });
    expect(close).toHaveBeenCalledOnce();
  });

  it("decodes a declared non-UTF-8 charset", async () => {
    mockRequest(new Response(new Uint8Array([0xe9]), {
      headers: { "content-type": "text/plain; charset=iso-8859-1" },
    }));

    await expect(createHttpFetch()(
      { url: "https://example.test" },
      signal,
    )).resolves.toMatchObject({
      body: { kind: "text", format: "plain", content: "é" },
    });
  });

  it("rejects binary responses and unsupported charsets", async () => {
    mockRequests([
      new Response("binary", { headers: { "content-type": "image/png" } }),
      new Response("text", {
        headers: { "content-type": "text/plain; charset=not-a-charset" },
      }),
    ]);
    const fetch = createHttpFetch();

    await expect(fetch({ url: "https://example.test/image" }, signal))
      .rejects.toMatchObject({ code: "unsupported-content-type" });
    await expect(fetch({ url: "https://example.test/text" }, signal))
      .rejects.toMatchObject({ code: "unsupported-charset" });
  });

  it("rejects declared and streamed oversized bodies", async () => {
    mockRequests([
      new Response("x", {
        headers: { "content-type": "text/plain", "content-length": "9" },
      }),
      new Response("abcdef", { headers: { "content-type": "text/plain" } }),
    ]);
    const fetch = createHttpFetch({ maxResponseBytes: 3 });

    await expect(fetch({ url: "https://example.test/declared" }, signal))
      .rejects.toMatchObject({ code: "response-too-large" });
    await expect(fetch({ url: "https://example.test/streamed" }, signal))
      .rejects.toMatchObject({ code: "response-too-large" });
  });

  it("rejects text that exceeds the decoded complete-document limit", async () => {
    mockRequest(new Response("abcd", { headers: { "content-type": "text/plain" } }));

    await expect(createHttpFetch({ maxDecodedCharacters: 3 })(
      { url: "https://example.test/decoded" }, signal,
    )).rejects.toMatchObject({ code: "response-too-large" });
  });
});

describe("HTTP Fetch redirects and configuration", () => {
  it("follows a relative same-origin redirect with a fresh resolution", async () => {
    mockRequests([
      new Response(null, {
        status: 302,
        headers: { location: "/final", "content-type": "text/plain" },
      }),
      new Response("done", { headers: { "content-type": "text/plain" } }),
    ]);

    await expect(createHttpFetch()(
      { url: "https://example.test/start" },
      signal,
    )).resolves.toMatchObject({
      url: "https://example.test/final",
      body: { content: "done" },
    });
    expect(publicFetchNetwork.resolve).toHaveBeenCalledTimes(2);
  });

  it("rejects cross-origin, missing, and excessive redirects", async () => {
    mockRequests([
      new Response(null, { status: 302, headers: { location: "https://other.test" } }),
      new Response(null, { status: 302 }),
      new Response(null, { status: 302, headers: { location: "/again" } }),
    ]);

    await expect(createHttpFetch()(
      { url: "https://example.test/start" }, signal,
    )).rejects.toMatchObject({ code: "redirect-blocked" });
    await expect(createHttpFetch()(
      { url: "https://example.test/missing" }, signal,
    )).rejects.toMatchObject({ code: "network-failed" });
    await expect(createHttpFetch({ maxRedirects: 0 })(
      { url: "https://example.test/limited" }, signal,
    )).rejects.toMatchObject({ code: "redirect-blocked" });
  });

  it("rejects invalid trusted limits and user agents", () => {
    expect(() => createHttpFetch({ maxResponseBytes: 0 }))
      .toThrow(expect.objectContaining({ code: "invalid-config" }));
    expect(() => createHttpFetch({ maxRedirects: 11 }))
      .toThrow(expect.objectContaining({ code: "invalid-config" }));
    expect(() => createHttpFetch({ userAgent: "bad\nheader" }))
      .toThrow(expect.objectContaining({ code: "invalid-config" }));
  });
});

function mockRequest(response: Response) {
  const close = vi.fn(async () => undefined);
  vi.spyOn(publicFetchNetwork, "request").mockResolvedValue({ response, close });
  return close;
}

function mockRequests(responses: Response[]): void {
  const queue = [...responses];
  vi.spyOn(publicFetchNetwork, "request").mockImplementation(async () => {
    const response = queue.shift();
    if (response === undefined) throw new FetchError("network-failed", "No response.");
    return { response, close: vi.fn(async () => undefined) } satisfies PinnedResponse;
  });
}
