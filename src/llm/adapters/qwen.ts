import { isContextWindowExceeded, LLMProviderError } from "../errors.js";
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
    this.baseUrl = normalizeBaseUrl(config.baseUrl);
    this.apiKey = normalizeApiKey(config.apiKey);
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
    if (!response.ok) throw await httpFailure(response);
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

async function httpFailure(response: Response): Promise<LLMProviderError> {
  const body = await readErrorBody(response);
  const details = parseErrorDetails(body);
  const retryAfterMs = parseRetryAfter(response.headers.get("retry-after"));
  const overflow = response.status === 400 && isContextWindowExceeded(details.code, details.message);
  const code = overflow
    ? "CONTEXT_WINDOW_EXCEEDED"
    : response.status === 401 || response.status === 403
      ? "AUTH"
      : response.status === 429
        ? "RATE_LIMIT"
        : response.status >= 500
          ? "SERVER"
          : "INVALID_REQUEST";
  return new LLMProviderError(
    code,
    overflow
      ? "Qwen rejected the request because it exceeds the model context window."
      : `Qwen API rejected the request with HTTP ${response.status}.`,
    {
      status: response.status,
      ...(retryAfterMs === undefined ? {} : { retryAfterMs }),
    },
  );
}

async function readErrorBody(response: Response): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) return "";
  const limit = 16_384;
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (length < limit) {
      const result = await reader.read();
      if (result.done) break;
      const chunk = result.value.subarray(0, limit - length);
      chunks.push(chunk);
      length += chunk.byteLength;
      if (chunk.byteLength < result.value.byteLength || length === limit) {
        await reader.cancel().catch(() => undefined);
        break;
      }
    }
  } catch {
    await reader.cancel().catch(() => undefined);
  } finally {
    reader.releaseLock();
  }
  const body = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(body);
}

function parseErrorDetails(body: string): { readonly code?: string; readonly message: string } {
  try {
    const parsed: unknown = JSON.parse(body);
    if (parsed === null || typeof parsed !== "object") return { message: body };
    const root = parsed as Record<string, unknown>;
    const error = root.error !== null && typeof root.error === "object"
      ? root.error as Record<string, unknown> : root;
    const code = typeof error.code === "string" ? error.code
      : typeof root.code === "string" ? root.code : undefined;
    const message = typeof error.message === "string" ? error.message
      : typeof root.message === "string" ? root.message
        : typeof root.detail === "string" ? root.detail : body;
    return { ...(code === undefined ? {} : { code }), message };
  } catch {
    return { message: body };
  }
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
