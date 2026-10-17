import { ChatGPTAuthError } from "../auth/chatgpt.js";
import { isContextWindowExceeded, LLMProviderError } from "../errors.js";
import type { LLMAdapter } from "../adapter.js";
import { serializeResponsesRequest } from "../protocols/responses/request.js";
import { translateResponsesSse } from "../protocols/responses/stream.js";
import type { GenerateRequest, ModelEvent } from "../types.js";

export interface OpenAIAdapterConfig {
  readonly auth: { accessToken(accountId?: string, signal?: AbortSignal): Promise<string> };
  readonly accountId?: string;
  readonly fetch?: typeof fetch;
}

export class OpenAIAdapter implements LLMAdapter {
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly config: OpenAIAdapterConfig) {
    this.fetchImpl = config.fetch ?? fetch;
  }

  async *stream(request: GenerateRequest): AsyncGenerator<ModelEvent> {
    if (request.maxTokens !== undefined || request.temperature !== undefined) {
      throw new LLMProviderError("UNSUPPORTED_PARAMETER", "ChatGPT subscription requests do not support maxTokens or temperature.");
    }
    const consumer = new AbortController();
    const signal = request.signal === undefined ? consumer.signal
      : AbortSignal.any([consumer.signal, request.signal]);
    try {
      let token: string;
      try {
        token = await this.config.auth.accessToken(this.config.accountId, signal);
      } catch (cause) {
        if (signal.aborted) throw cause;
        throw new LLMProviderError("AUTH", cause instanceof ChatGPTAuthError
          ? `ChatGPT authentication failed (${cause.code}). Run pnpm chatgpt login.`
          : "ChatGPT credentials could not be loaded.");
      }
      signal.throwIfAborted();
      let response: Response;
      try {
        response = await this.fetchImpl("https://api.openai.com/v1/responses", {
          method: "POST",
          headers: { accept: "text/event-stream", "content-type": "application/json",
            authorization: `Bearer ${token}` },
          body: JSON.stringify(serializeResponsesRequest(request, { toolNamespace: "navo" })),
          signal,
        });
      } catch (cause) {
        if (signal.aborted) throw cause;
        throw new LLMProviderError("TRANSPORT", "OpenAI Responses request could not be reached.", { cause });
      }
      if (!response.ok) throw await httpFailure(response);
      if (response.body === null) throw new LLMProviderError("EMPTY_RESPONSE", "OpenAI returned no response body.");
      yield* translateResponsesSse(response.body, {
        provider: request.provider, model: request.model, toolNamespace: "navo",
      });
    } finally {
      consumer.abort();
    }
  }
}

async function httpFailure(response: Response): Promise<LLMProviderError> {
  let code = "OPENAI_HTTP_ERROR";
  let diagnostic = "";
  try {
    const body: unknown = await response.json();
    if (body !== null && typeof body === "object" && "error" in body) {
      const error = body.error;
      if (error !== null && typeof error === "object" && "message" in error && typeof error.message === "string") {
        diagnostic = error.message.slice(0, 1_024);
      }
      if (error !== null && typeof error === "object" && "code" in error
          && typeof error.code === "string" && /^[a-zA-Z0-9_]{1,100}$/.test(error.code)) {
        code = error.code;
      }
    } else if (body !== null && typeof body === "object" && "detail" in body && typeof body.detail === "string") {
      diagnostic = body.detail.slice(0, 1_024);
    }
  } catch {
    await response.body?.cancel().catch(() => undefined);
  }
  const usage = code === "subscription_sharing_usage_limit_exceeded"
    || code === "subscription_sharing_usage_unavailable";
  const normalizedCode = isContextWindowExceeded(code, diagnostic) ? "CONTEXT_WINDOW_EXCEEDED" : code;
  return new LLMProviderError(normalizedCode,
    `OpenAI rejected the request with HTTP ${response.status} (${normalizedCode}).${diagnostic ? ` ${diagnostic}` : ""}${usage
      ? " Check ChatGPT Settings > Usage; no billing route was switched." : ""}`,
    { status: response.status });
}
