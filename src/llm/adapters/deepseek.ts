import { httpFailure, normalizeApiKey, normalizeBaseUrl } from "../protocols/completions/http.js";
import { LLMProviderError } from "../errors.js";
import type { LLMAdapter } from "../adapter.js";
import { serializeChatCompletionsRequest } from "../protocols/completions/request.js";
import { translateChatCompletionsSse } from "../protocols/completions/stream.js";
import type { GenerateRequest, ModelEvent } from "../types.js";

export interface DeepSeekAdapterConfig {
  readonly baseUrl: string;
  readonly apiKey?: string;
  readonly enableThinking?: boolean;
  readonly reasoningEffort?: "low" | "high" | "max";
  readonly fetch?: typeof fetch;
}

export class DeepSeekAdapter implements LLMAdapter {
  private readonly baseUrl: string;
  private readonly apiKey: string | undefined;
  private readonly enableThinking: boolean;
  private readonly reasoningEffort: "low" | "high" | "max";
  private readonly fetchImpl: typeof fetch;

  constructor(config: DeepSeekAdapterConfig) {
    this.baseUrl = normalizeBaseUrl(config.baseUrl, "DeepSeek");
    this.apiKey = normalizeApiKey(config.apiKey, "DeepSeek");
    this.enableThinking = config.enableThinking ?? true;
    this.reasoningEffort = config.reasoningEffort ?? "high";
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
          thinking: { type: this.enableThinking ? "enabled" : "disabled" },
          ...(this.enableThinking ? { reasoning_effort: this.reasoningEffort } : {}),
        }),
        ...(request.signal === undefined ? {} : { signal: request.signal }),
      });
    } catch (cause: unknown) {
      if (request.signal?.aborted) throw cause;
      throw new LLMProviderError(
        "TRANSPORT",
        "DeepSeek API request could not be reached.",
        { cause },
      );
    }
    if (!response.ok) throw await httpFailure(response, "DeepSeek");
    if (response.body === null) {
      throw new LLMProviderError("EMPTY_RESPONSE", "DeepSeek API returned no response body.");
    }
    yield* translateChatCompletionsSse(response.body, {
      errorLabel: "DeepSeek",
      reasoningField: "reasoning_content",
      generatedToolCallIdPrefix: "deepseek-generated",
    });
  }
}

