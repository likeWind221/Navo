import { describe, expect, it, vi } from "vitest";
import { OpenRouterEmbeddingAdapter, OPENROUTER_EMBEDDING_MODEL } from "../../../src/embedding/adapters/openrouter.js";

const vector = () => Array.from({ length: 2048 }, (_item, index) => index === 0 ? 1 : 0);

describe("OpenRouter Nemotron Embedding adapter", () => {
  it("uses raw text with passage/query modes and validates 2048-dimensional ordered vectors", async () => {
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      const { input } = JSON.parse(String(init?.body)) as { input: string[] };
      return Response.json({ data: input.map((_text, index) => ({ index, embedding: vector() })).reverse() });
    });
    const adapter = new OpenRouterEmbeddingAdapter({ apiKey: "test-key", fetch: request });
    expect(adapter).toMatchObject({ id: "openrouter", model: OPENROUTER_EMBEDDING_MODEL, dimension: 2048,
      documentTemplateVersion: "nemotron35-passage-v1", queryTemplateVersion: "nemotron35-query-v1" });
    expect(await adapter.embedMany({ kind: "document", inputs: ["one", "two"] })).toHaveLength(2);
    await adapter.embedMany({ kind: "query", inputs: ["question"] });
    expect(String(request.mock.calls[0]?.[0])).toBe("https://openrouter.ai/api/v1/embeddings");
    expect(new Headers(request.mock.calls[0]?.[1]?.headers).get("authorization")).toBe("Bearer test-key");
    expect(JSON.parse(String(request.mock.calls[0]?.[1]?.body))).toEqual({ model: OPENROUTER_EMBEDDING_MODEL,
      input: ["one", "two"], input_type: "passage", encoding_format: "float" });
    expect(JSON.parse(String(request.mock.calls[1]?.[1]?.body))).toEqual({ model: OPENROUTER_EMBEDDING_MODEL,
      input: ["question"], input_type: "query", encoding_format: "float" });
  });

  it("keeps the selected input mode when splitting an oversized batch", async () => {
    const request = vi.fn<typeof fetch>(async (_url, init) => {
      const body = JSON.parse(String(init?.body)) as { input: string[]; input_type: string };
      expect(body.input_type).toBe("passage");
      return body.input.length > 1 ? new Response("large", { status: 413 })
        : Response.json({ data: [{ index: 0, embedding: vector() }] });
    });
    const adapter = new OpenRouterEmbeddingAdapter({ apiKey: "test-key", fetch: request });
    await expect(adapter.embedMany({ kind: "document", inputs: ["a", "b"] })).resolves.toHaveLength(2);
    expect(request).toHaveBeenCalledTimes(3);
  });

  it("rejects unsupported configurations, wrong dimensions and payment errors without retries", async () => {
    expect(() => new OpenRouterEmbeddingAdapter({ apiKey: " " })).toThrow("API key");
    expect(() => new OpenRouterEmbeddingAdapter({ apiKey: "key\nunsafe" })).toThrow("newlines");
    expect(() => new OpenRouterEmbeddingAdapter({ apiKey: "key", model: "other/model" })).toThrow("currently supports");
    const wrong = new OpenRouterEmbeddingAdapter({ apiKey: "key", fetch: async () => Response.json({
      data: [{ index: 0, embedding: new Array(2560).fill(1) }] }) });
    await expect(wrong.embedMany({ kind: "query", inputs: ["question"] })).rejects.toMatchObject({ code: "invalid-response" });
    const payment = vi.fn<typeof fetch>(async () => new Response("payment", { status: 402 }));
    const adapter = new OpenRouterEmbeddingAdapter({ apiKey: "key", fetch: payment });
    await expect(adapter.embedMany({ kind: "query", inputs: ["question"] })).rejects.toMatchObject({ code: "request-failed" });
    expect(payment).toHaveBeenCalledOnce();
  });
});
