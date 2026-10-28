import { isContextWindowExceeded, LLMProviderError } from "../../errors.js";

export async function httpFailure(response: Response, label: string): Promise<LLMProviderError> {
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
      ? `${label} rejected the request because it exceeds the model context window.`
      : `${label} API rejected the request with HTTP ${response.status}.`,
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

export function normalizeBaseUrl(value: string, label: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch (cause: unknown) {
    throw new TypeError(`${label} base URL must be an absolute HTTP(S) URL.`, { cause });
  }
  if ((url.protocol !== "http:" && url.protocol !== "https:")
      || url.username.length > 0 || url.password.length > 0) {
    throw new TypeError(`${label} base URL must be an HTTP(S) URL without credentials.`);
  }
  return url.href.replace(/\/$/, "");
}

export function normalizeApiKey(value: string | undefined, label: string): string | undefined {
  if (value === undefined) return undefined;
  if (value.length === 0 || /[\r\n]/.test(value)) {
    throw new TypeError(`${label} API key must be non-empty and must not contain newlines.`);
  }
  return value;
}
