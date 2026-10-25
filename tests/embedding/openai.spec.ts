import { describe, expect, it, vi } from "vitest";
import { OpenAIEmbeddingProvider } from "../../src/embedding/openai.js";

const vector = (value: number) => Array.from({ length: 2560 }, (_item, index) => index === 0 ? value : 0);

describe("OpenAI-compatible Embedding provider", () => {
  it("restores response order and applies distinct document/query templates", async () => {
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      return Response.json({ data: body.input.map((_input, index) => ({ index, embedding: vector(index + 1) })).reverse() });
    });
    const provider = create(request);
    const result = await provider.embedMany({ kind: "document", inputs: ["one", "two"] });
    expect(provider.model).toBe("Qwen3-Embedding-4B");
    expect(provider.dimension).toBe(2560);
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body)).model).toBe("Qwen3-Embedding-4B");
    expect(result.map(item => [item.length, item[0]])).toEqual([[2560, 1], [2560, 2]]);
    await provider.embedMany({ kind: "query", inputs: ["question"] });
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body)).input).toEqual(["one", "two"]);
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body)).input[0]).toMatch(/^Instruct: .+\nQuery: question$/);
  });

  it.each([
    { data: [{ index: 0, embedding: [1] }] },
    { data: [{ index: 0, embedding: Array.from({ length: 1024 }, () => 1) }] },
    { data: [{ index: 0, embedding: vector(1) }, { index: 0, embedding: vector(1) }] },
    { data: [] },
    { data: [{ index: 0, embedding: [...vector(1).slice(0, -1), null] }] },
  ])("rejects an invalid response atomically", async response => {
    const provider = create(vi.fn<typeof fetch>(async () => Response.json(response)));
    await expect(provider.embedMany({ kind: "document", inputs: ["one"] })).rejects.toMatchObject({ code: "invalid-response" });
  });

  it("does not retry authentication failures and retries recoverable failures finitely", async () => {
    const auth = vi.fn<typeof fetch>(async () => new Response("no", { status: 401 }));
    await expect(create(auth).embedMany({ kind: "document", inputs: ["one"] })).rejects.toMatchObject({ code: "authentication-failed" });
    expect(auth).toHaveBeenCalledOnce();

    const recover = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("busy", { status: 429, headers: { "retry-after": "0" } }))
      .mockResolvedValueOnce(new Response("bad", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ data: [{ index: 0, embedding: vector(1) }] }));
    const recovered = await create(recover).embedMany({ kind: "document", inputs: ["one"] });
    expect(recovered[0]).toEqual(vector(1));
    expect(recover).toHaveBeenCalledTimes(3);
  });

  it("splits an oversized batch, rejects oversized singles, bad JSON and cancellation", async () => {
    const split = vi.fn<typeof fetch>(async (_url, init) => {
      const input = (JSON.parse(String(init?.body)) as { input: string[] }).input;
      return input.length > 1 ? new Response("too many tokens", { status: 413 })
        : Response.json({ data: [{ index: 0, embedding: vector(1) }] });
    });
    const splitResult = await create(split).embedMany({ kind: "document", inputs: ["a", "b"] });
    expect(splitResult.map(item => item.length)).toEqual([2560, 2560]);
    await expect(create(vi.fn<typeof fetch>(async () => new Response("token limit", { status: 413 })))
      .embedMany({ kind: "document", inputs: ["a"] })).rejects.toMatchObject({ code: "input-too-large" });
    await expect(create(vi.fn<typeof fetch>(async () => new Response("{")))
      .embedMany({ kind: "document", inputs: ["a"] })).rejects.toMatchObject({ code: "invalid-response" });
    const controller = new AbortController();
    controller.abort(new Error("cancelled"));
    await expect(create(split).embedMany({ kind: "document", inputs: ["a"], signal: controller.signal })).rejects.toThrow("cancelled");
  });

  it("aborts timed-out requests and never exposes credentials in diagnostics", async () => {
    const request = vi.fn<typeof fetch>(async (_url, init) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    }));
    const provider = new OpenAIEmbeddingProvider({ endpoint: "http://embedding.test/v1/embeddings", apiKey: "top-secret",
      fetch: request, policy: { timeoutMs: 1, maxAttempts: 1 } });
    const error = await provider.embedMany({ kind: "document", inputs: ["one"] }).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "request-failed" });
    expect(String(error)).not.toContain("top-secret");
    expect(String(request.mock.calls[0]?.[0])).toBe("http://embedding.test/v1/embeddings");
  });
});

function create(request: typeof fetch) {
  return new OpenAIEmbeddingProvider({ endpoint: "http://embedding.test", fetch: request,
    sleep: async () => undefined, random: () => 0 });
}
