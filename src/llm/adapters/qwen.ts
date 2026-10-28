import { httpFailure, normalizeApiKey, normalizeBaseUrl } from "../protocols/completions/http.js";
import { LLMProviderError } from "../errors.js";
import type { LLMAdapter } from "../adapter.js";
import { serializeChatCompletionsRequest } from "../protocols/completions/request.js";
import { translateChatCompletionsSse } from "../protocols/completions/stream.js";
import type { GenerateRequest, ModelEvent } from "../types.js";

export interface QwenChatAdapterConfig {
  readonly baseUrl: string;
  readonly apiKey?: string;
  /** Qwen chat-template control; defaults to false for visible-answer reliability. */
  readonly enableThinking?: boolean;
  readonly fetch?: typeof fetch;
}

/** OpenAI-compatible Chat Completions SSE adapter used by Qwen/vLLM hosts. */
export class QwenChatCompletionsAdapter implements LLMAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly enableThinking: boolean;
  private readonly fetchImpl: typeof fetch;

  constructor(config: QwenChatAdapterConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl, "Qwen");
    this.apiKey = normalizeApiKey(config.apiKey, "Qwen");
    this.enableThinking = config.enableThinking ?? false;
    this.fetchImpl = config.fetch ?? fetch;
  }

  async *stream(request: GenerateRequest): AsyncGenerator<ModelEvent> {
    let response: Response;
    try {
      response = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          accept: "text/event-stream",
          "content-type": "application/json",
          ...(this.apiKey === undefined
            ? {} : { authorization: `Bearer ${this.apiKey}` }),
        },
        body: JSON.stringify({
          ...serializeChatCompletionsRequest(request, { reasoningField: "reasoning_content" }),
          chat_template_kwargs: { enable_thinking: this.enableThinking },
        }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
    } catch (cause: unknown) {
      if (request.signal?.aborted) throw cause;
      throw new LLMProviderError(
        "TRANSPORT",
        "Qwen API request could not be reached.",
        { cause },
      );
    }
    if (!response.ok) throw await httpFailure(response, "Qwen");
    if (response.body === null) {
      throw new LLMProviderError("EMPTY_RESPONSE", "Qwen API returned no response body.");
    }
    yield* translateChatCompletionsSse(response.body, {
      errorLabel: "Qwen",
      reasoningField: "reasoning",
      generatedToolCallIdPrefix: "qwen-generated",
    });
  }
}
