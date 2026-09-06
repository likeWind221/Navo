import { Service } from "cordis";
import type { Context } from "cordis";

import {
  LLMProviderError,
  LLMServiceError,
  isLLMServiceError,
} from "./errors.js";
import type {
  FinishChunk,
  GenerateRequest,
  LlmFailure,
  StreamChunk,
} from "./types.js";
import type { LLMAdapter } from "./adapter.js";

export {
  LLMServiceError,
  isLLMServiceError,
} from "./errors.js";
export type { LLMServiceErrorCode } from "./errors.js";

export type LLMAdapterRegistration = () => void;

declare module "cordis" {
  interface Context {
    llm: LLMService;
  }
}

/** Provider-agnostic streaming LLM gateway exposed as `ctx.llm`. */
export class LLMService extends Service {
  private readonly adapters = new Map<string, LLMAdapter>();

  constructor(ctx: Context) {
    super(ctx, "llm");
  }

  registerAdapter(
    provider: string,
    adapter: LLMAdapter,
  ): LLMAdapterRegistration {
    assertProvider(provider);
    if (this.adapters.has(provider)) {
      throw new LLMServiceError(
        "adapter-already-registered",
        `LLM adapter for provider '${provider}' is already registered.`,
      );
    }

    this.adapters.set(provider, adapter);
    let disposed = false;

    return () => {
      if (disposed) {
        return;
      }
      disposed = true;
      if (this.adapters.get(provider) === adapter) {
        this.adapters.delete(provider);
      }
    };
  }

  stream(request: GenerateRequest): AsyncIterable<StreamChunk> {
    return this.adapterStream(request);
  }

  private async *adapterStream(
    request: GenerateRequest,
  ): AsyncGenerator<StreamChunk> {
    let iterator: AsyncIterator<StreamChunk>;
    try {
      assertNotAborted(request.signal);
      const adapter = this.adapters.get(request.provider);
      if (!adapter) {
        throw new LLMServiceError(
          "adapter-not-found",
          `No LLM adapter registered for provider '${request.provider}' while streaming '${request.model}'.`,
        );
      }
      iterator = adapter.stream(request)[Symbol.asyncIterator]();
    } catch (error: unknown) {
      yield failureChunk(error, request.signal);
      return;
    }

    let completed = false;
    try {
      while (true) {
        let item:
          | { readonly done: true }
          | { readonly done: false; readonly value: StreamChunk };
        try {
          const next = await nextWithAbort(
            () => iterator.next(),
            request.signal,
          );
          item = next.done
            ? { done: true }
            : { done: false, value: next.value };
        } catch (error: unknown) {
          completed = !request.signal?.aborted;
          yield failureChunk(error, request.signal);
          return;
        }

        if (item.done) {
          completed = true;
          return;
        }
        yield item.value;
      }
    } finally {
      if (!completed) {
        await closeIterator(iterator, request.signal);
      }
    }
  }
}

function assertProvider(provider: string): void {
  if (provider.trim().length === 0) {
    throw new LLMServiceError(
      "adapter-not-found",
      "LLM provider must be a non-empty string.",
    );
  }
}

function assertNotAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw abortedError(signal.reason);
  }
}

/** Race one iterator read against cancellation while observing late settlement. */
function nextWithAbort<TValue>(
  start: () => Promise<TValue>,
  signal: AbortSignal | undefined,
): Promise<TValue> {
  if (signal === undefined) {
    return start();
  }
  if (signal.aborted) {
    return Promise.reject(abortedError(signal.reason));
  }

  return new Promise<TValue>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void): void => {
      if (settled) {
        return;
      }
      settled = true;
      signal.removeEventListener("abort", onAbort);
      settle();
    };
    const onAbort = (): void => {
      finish(() => reject(abortedError(signal.reason)));
    };

    signal.addEventListener("abort", onAbort, { once: true });

    let operation: Promise<TValue>;
    try {
      operation = start();
    } catch (error: unknown) {
      finish(() => reject(error));
      return;
    }

    void operation.then(
      (value) => finish(() => resolve(value)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

/** Close cooperatively; an aborted, uncooperative iterator must not block its caller. */
async function closeIterator(
  iterator: AsyncIterator<StreamChunk>,
  signal: AbortSignal | undefined,
): Promise<void> {
  const close = iterator.return?.bind(iterator);
  if (!close) {
    return;
  }

  if (signal?.aborted) {
    try {
      void Promise.resolve(close()).catch(() => undefined);
    } catch {
      // Cancellation already owns the outcome; cleanup failure is only observed.
    }
    return;
  }

  await close();
}

function failureChunk(
  error: unknown,
  signal: AbortSignal | undefined,
): FinishChunk {
  if (signal?.aborted) {
    return { type: "finish", reason: { kind: "cancelled" } };
  }
  return {
    type: "finish",
    reason: { kind: "error", failure: normalizeFailure(error) },
  };
}

function normalizeFailure(error: unknown): LlmFailure {
  if (error instanceof LLMProviderError) {
    return {
      code: error.code,
      message: error.message,
      ...(error.status === undefined ? {} : { status: error.status }),
      ...(error.retryAfterMs === undefined ? {} : { retryAfterMs: error.retryAfterMs }),
    };
  }
  if (error instanceof LLMServiceError) {
    return { code: error.code, message: error.message };
  }
  if (error instanceof Error) {
    return { code: "stream-failed", message: error.message };
  }
  return { code: "stream-failed", message: String(error) };
}

function abortedError(cause?: unknown): LLMServiceError {
  return new LLMServiceError("aborted", "LLM stream was aborted.", { cause });
}
