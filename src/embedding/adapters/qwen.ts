import { OpenAIEmbeddingProvider, type OpenAIEmbeddingConfig } from "../protocols/openai.js";

const QUERY_TASK = "Given a user question, retrieve relevant passages that answer the question";

export class QwenEmbeddingAdapter extends OpenAIEmbeddingProvider {
  constructor(config: OpenAIEmbeddingConfig) {
    super(config, {
      id: "openai-compatible",
      model: "Qwen3-Embedding-4B",
      dimension: 2560,
      documentTemplateVersion: "qwen3-document-v1",
      queryTemplateVersion: "qwen3-query-v1",
      format: (kind, input) => kind === "query" ? `Instruct: ${QUERY_TASK}\nQuery: ${input}` : input,
      parameters: () => ({}),
    });
  }
}
