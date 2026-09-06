import { FetchError } from "./errors.js";
import type { FetchRequest, FetchResult } from "./types.js";
import {
  normalizeFetchRequest,
  normalizeFetchResult,
  resolveFetchCoreConfig,
} from "./validation.js";
import type {
  FetchCoreConfig,
  ResolvedFetchCoreConfig,
} from "./validation.js";

type FetchOperation = (
  request: FetchRequest,
  signal: AbortSignal,
) => Promise<unknown>;

/** Internal non-Cordis owner of one bounded Fetch execution path. */
export class FetchCore {
  private readonly operation: FetchOperation;
  private readonly config: ResolvedFetchCoreConfig;

  constructor(operation: FetchOperation, config: FetchCoreConfig = {}) {
    if (typeof operation !== "function") {
      throw new FetchError("invalid-config", "Fetch operation must be a function.");
    }
    this.operation = operation;
    this.config = resolveFetchCoreConfig(config);
  }

  /** Validate and execute one request with owned cancellation and deadline state. */
  async fetch(
    request: FetchRequest,
    signal?: AbortSignal,
  ): Promise<FetchResult> {
    assertActive(signal);
    const input = normalizeFetchRequest(request);
    const controller = new AbortController();
    const deadline = performance.now() + this.config.timeoutMs;

    return await new Promise<FetchResult>((resolve, reject) => {
      let settled = false;
      const timer = setTimeout(onTimeout, this.config.timeoutMs);
      signal?.addEventListener("abort", onAbort, { once: true });

      const finish = (error: FetchError | undefined, result?: FetchResult): void => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (error !== undefined) {
          controller.abort(error);
          reject(error);
        } else {
          resolve(result!);
        }
      };

      const cancelled = (): boolean => signal?.aborted === true;
      function onAbort(): void {
        finish(new FetchError("aborted", "Fetch was cancelled by its caller."));
      }
      function onTimeout(): void {
        if (cancelled()) return onAbort();
        finish(new FetchError("timeout", "Fetch exceeded its execution deadline."));
      }
      const accept = (value: unknown, failed: boolean): void => {
        if (settled) return;
        if (cancelled()) return onAbort();
        if (performance.now() >= deadline) return onTimeout();
        if (failed) return finish(normalizeOperationError(value));
        try {
          const result = normalizeFetchResult(
            value,
            this.config.maxBodyCharacters,
          );
          if (cancelled()) return onAbort();
          if (performance.now() >= deadline) return onTimeout();
          finish(undefined, result);
        } catch (error: unknown) {
          finish(normalizeOperationError(error));
        }
      };

      try {
        Promise.resolve(this.operation(input, controller.signal)).then(
          (value) => accept(value, false),
          (error: unknown) => accept(error, true),
        );
      } catch (error: unknown) {
        accept(error, true);
      }
    });
  }
}

function assertActive(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw new FetchError("aborted", "Fetch was cancelled before execution.");
  }
}

function normalizeOperationError(error: unknown): FetchError {
  if (error instanceof FetchError) return error;
  return new FetchError(
    "network-failed",
    "Fetch operation failed without a classified error.",
    { cause: error },
  );
}
