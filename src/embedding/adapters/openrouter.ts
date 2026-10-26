import { EmbeddingError } from "../errors.js";
import { OpenAIEmbeddingProvider, type OpenAIEmbeddingConfig } from "../protocols/openai.js";

export type OpenRouterEmbeddingConfig = Omit<OpenAIEmbeddingConfig, "endpoint" | "apiKey"> & {
  readonly endpoint?: string;
  readonly apiKey: string;
};

export const OPENROUTER_EMBEDDING_MODEL = "nvidia/nemotron-3.5-embed-1b:free";
export const OPENROUTER_EMBEDDING_ENDPOINT = "https://openrouter.ai/api/v1";

export class OpenRouterEmbeddingAdapter extends OpenAIEmbeddingProvider {
  constructor(config: OpenRouterEmbeddingConfig) {
    if (!config.apiKey || !config.apiKey.trim()) {
      throw new EmbeddingError("invalid-config", "OpenRouter Embedding requires an API key.");
    }
    if (config.model !== undefined && config.model.trim() !== OPENROUTER_EMBEDDING_MODEL) {
      throw new EmbeddingError("invalid-config", `OpenRouter Embedding currently supports ${OPENROUTER_EMBEDDING_MODEL}.`);
    }
    super({ ...config, endpoint: config.endpoint ?? OPENROUTER_EMBEDDING_ENDPOINT }, {
      id: "openrouter",
      model: OPENROUTER_EMBEDDING_MODEL,
      dimension: 2048,
      documentTemplateVersion: "nemotron35-passage-v1",
      queryTemplateVersion: "nemotron35-query-v1",
      format: (_kind, input) => input,
      parameters: kind => ({ input_type: kind === "query" ? "query" : "passage", encoding_format: "float" }),
    });
  }
}
