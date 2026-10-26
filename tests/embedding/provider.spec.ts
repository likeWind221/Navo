import { describe, expect, it } from "vitest";
import { createEmbeddingProvider, resolveEmbeddingConfig } from "../../src/embedding/provider.js";

describe("Embedding provider selection", () => {
  it("requires explicit OpenRouter selection and reads the process key only for that provider", () => {
    expect(resolveEmbeddingConfig({ OPENROUTER_API_KEY: "key" })).toBeUndefined();
    const config = resolveEmbeddingConfig({ EMBEDDING_PROVIDER: "openrouter", OPENROUTER_API_KEY: "key" });
    expect(config).toEqual({ provider: "openrouter", endpoint: "https://openrouter.ai/api/v1",
      model: "nvidia/nemotron-3.5-embed-1b:free", apiKey: "key" });
    expect(createEmbeddingProvider(config!)).toMatchObject({ id: "openrouter", dimension: 2048 });
    expect(resolveEmbeddingConfig({ EMBEDDING_PROVIDER: "openrouter", OPENROUTER_API_KEY: "general",
      EMBEDDING_API_KEY: "dedicated" })?.apiKey).toBe("dedicated");
  });

  it("keeps the existing Qwen identity and model templates for saved indexes", () => {
    const config = resolveEmbeddingConfig({ EMBEDDING_BASE_URL: "http://localhost:8081/v1" });
    expect(createEmbeddingProvider(config!)).toMatchObject({ id: "openai-compatible", model: "Qwen3-Embedding-4B",
      dimension: 2560, documentTemplateVersion: "qwen3-document-v1", queryTemplateVersion: "qwen3-query-v1" });
  });

  it("rejects unknown providers, missing credentials and a model without a matching profile", () => {
    expect(() => resolveEmbeddingConfig({ EMBEDDING_PROVIDER: "unknown" })).toThrow("EMBEDDING_PROVIDER");
    expect(() => resolveEmbeddingConfig({ EMBEDDING_PROVIDER: "openrouter" })).toThrow("OPENROUTER_API_KEY");
    expect(() => resolveEmbeddingConfig({ EMBEDDING_PROVIDER: "openrouter", OPENROUTER_API_KEY: "key",
      EMBEDDING_MODEL: "other/model" })).toThrow("currently supports");
  });
});
