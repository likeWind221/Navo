import { LLMProviderError } from "../errors.js";
import type { LLMAdapter } from "../adapter.js";
import { translateQwenSse } from "./qwen/sse.js";
import { serializeQwenRequest } from "./qwen/request.js";
import type { GenerateRequest, StreamChunk } from "../types.js";

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
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.apiKey = normalizeApiKey(config.apiKey);
    this.enableThinking = config.enableThinking ?? false;
    this.fetchImpl = config.fetch ?? fetch;
  }

  async *stream(request: GenerateRequest): AsyncGenerator<StreamChunk> {
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
        body: JSON.stringify(serializeQwenRequest(request, this.enableThinking)),
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
    if (!response.ok) throw await httpFailure(response);
    if (response.body === null) {
      throw new LLMProviderError("EMPTY_RESPONSE", "Qwen API returned no response body.");
    }
    yield* translateQwenSse(response.body);
  }
}

async function httpFailure(response: Response): Promise<LLMProviderError> {
  await response.body?.cancel().catch(() => undefined);
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
  const code = response.status === 401 || response.status === 403
    ? "AUTH"
    : response.status === 429
      ? "RATE_LIMIT"
      : response.status >= 500
        ? "SERVER"
        : "INVALID_REQUEST";
  return new LLMProviderError(
    code,
    `Qwen API rejected the request with HTTP ${response.status}.`,
    {
      status: response.status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    },
  );
}

function parseRetryAfter(value: string | null): number | undefined {
  if (value === null) return undefined;
  if (/^\d+$/.test(value)) return Number(value) * 1_000;
  const delay = Date.parse(value) - Date.now();
  return Number.isFinite(delay) && delay > 0 ? delay : undefined;
}

function normalizeBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause: unknown) {
    throw new TypeError("Qwen base URL must be an absolute HTTP(S) URL.", { cause });
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:")
      || url.username.length > 0 || url.password.length > 0) {
    throw new TypeError("Qwen base URL must be an HTTP(S) URL without credentials.");
  }
  return url.href.replace(/\/$/, "");
}

function normalizeApiKey(value: string | undefined): string | undefined {
  if (value === undefined) return undefined;
  if (value.length === 0 || /[\r\n]/.test(value)) {
    throw new TypeError("Qwen API key must be non-empty and must not contain newlines.");
  }
  return value;
}
