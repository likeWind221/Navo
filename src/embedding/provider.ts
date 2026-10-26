import { QwenEmbeddingAdapter } from "./adapters/qwen.js";
import { OpenRouterEmbeddingAdapter, OPENROUTER_EMBEDDING_ENDPOINT, OPENROUTER_EMBEDDING_MODEL } from "./adapters/openrouter.js";
import type { OpenAIEmbeddingConfig } from "./protocols/openai.js";
import type { EmbeddingProvider } from "./types.js";

export type EmbeddingConfig = {
  readonly provider: "qwen" | "openrouter";
  readonly endpoint: string;
  readonly model: string;
  readonly apiKey?: string;
  readonly revision?: string;
};

export type EmbeddingTransportConfig = Pick<OpenAIEmbeddingConfig, "policy" | "fetch" | "sleep" | "random">;

export function createEmbeddingProvider(config: EmbeddingConfig, transport: EmbeddingTransportConfig = {}): EmbeddingProvider {
  if (config.provider === "openrouter") {
    return new OpenRouterEmbeddingAdapter({ ...config, ...transport, apiKey: config.apiKey ?? "" });
  }
  return new QwenEmbeddingAdapter({ ...config, ...transport });
}

export function resolveEmbeddingConfig(env: NodeJS.ProcessEnv = process.env): EmbeddingConfig | undefined {
  const provider = env.EMBEDDING_PROVIDER?.trim() ?? "qwen";
  if (provider !== "qwen" && provider !== "openrouter") {
    throw new TypeError("EMBEDDING_PROVIDER must be 'qwen' or 'openrouter'.");
  }
  const configuredEndpoint = env.EMBEDDING_BASE_URL?.trim();
  if (env.EMBEDDING_BASE_URL !== undefined && !configuredEndpoint) {
    throw new TypeError("EMBEDDING_BASE_URL must be a non-empty URL when provided.");
  }
  const endpoint = configuredEndpoint ?? (provider === "openrouter" ? OPENROUTER_EMBEDDING_ENDPOINT : undefined);
  if (endpoint === undefined) {
    if ([env.EMBEDDING_API_KEY, env.EMBEDDING_MODEL, env.EMBEDDING_REVISION].some(value => value !== undefined)) {
      throw new TypeError("EMBEDDING_BASE_URL is required when other Embedding settings are provided.");
    }
    return undefined;
  }
  const apiKey = env.EMBEDDING_API_KEY ?? (provider === "openrouter" ? env.OPENROUTER_API_KEY : undefined);
  if (apiKey !== undefined && (!apiKey.trim() || /[\r\n]/.test(apiKey))) {
    throw new TypeError("EMBEDDING_API_KEY must be non-empty and must not contain newlines.");
  }
  if (provider === "openrouter" && apiKey === undefined) {
    throw new TypeError("OPENROUTER_API_KEY or EMBEDDING_API_KEY is required for OpenRouter Embedding.");
  }
  const model = env.EMBEDDING_MODEL?.trim() || (provider === "openrouter" ? OPENROUTER_EMBEDDING_MODEL : "Qwen3-Embedding-4B");
  if (provider === "openrouter" && model !== OPENROUTER_EMBEDDING_MODEL) {
    throw new TypeError(`OpenRouter Embedding currently supports ${OPENROUTER_EMBEDDING_MODEL}.`);
  }
  return Object.freeze({ provider, endpoint, model,
    ...(apiKey === undefined ? {} : { apiKey }),
    ...(env.EMBEDDING_REVISION?.trim() ? { revision: env.EMBEDDING_REVISION.trim() } : {}) });
}
