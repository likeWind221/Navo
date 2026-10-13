import { LLMProviderError } from "../errors.js";

export const SSE_MAX_EVENT_CHARS = 1_048_576;

export interface SseReadOptions {
  readonly errorLabel: string;
}

export async function* readSseData(
  body: ReadableStream<Uint8Array>,
  options: SseReadOptions,
): AsyncGenerator<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = "";
  let exhausted = false;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) {
        exhausted = true;
        buffer += decoder.decode();
        break;
      }
      buffer += decoder.decode(next.value, { stream: true });
      const split = takeEvents(buffer, options.errorLabel);
      buffer = split.rest;
      assertEventSize(buffer.length, options.errorLabel);
      for (const payload of split.payloads) yield payload;
    }
    if (buffer.trim().length > 0) {
      assertEventSize(buffer.length, options.errorLabel);
      const payload = eventData(buffer);
      if (payload.length > 0) yield payload;
    }
  } catch (cause: unknown) {
    if (cause instanceof LLMProviderError) throw cause;
    throw invalidEvent(options.errorLabel, "stream is invalid.", cause);
  } finally {
    if (!exhausted) await reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}

function takeEvents(
  buffer: string,
  errorLabel: string,
): { readonly payloads: string[]; readonly rest: string } {
  const payloads: string[] = [];
  let rest = buffer;
  while (true) {
    const match = /\r?\n\r?\n/.exec(rest);
    if (match === null) return { payloads, rest };
    assertEventSize(match.index, errorLabel);
    const raw = rest.slice(0, match.index);
    rest = rest.slice(match.index + match[0].length);
    const payload = eventData(raw);
    if (payload.length > 0) payloads.push(payload);
  }
}

function assertEventSize(
  characters: number,
  errorLabel: string,
): void {
  if (characters > SSE_MAX_EVENT_CHARS) {
    throw invalidEvent(errorLabel, "event exceeds the size limit.");
  }
}

function eventData(raw: string): string {
  return raw.split(/\r?\n/)
    .filter((line) => line === "data" || line.startsWith("data:"))
    .map((line) => line === "data" ? "" : line.slice(5).replace(/^ /, ""))
    .join("\n");
}

function invalidEvent(errorLabel: string, message: string, cause?: unknown): LLMProviderError {
  return new LLMProviderError("TRANSPORT", `${errorLabel} SSE ${message}`, cause === undefined ? {} : { cause });
}
