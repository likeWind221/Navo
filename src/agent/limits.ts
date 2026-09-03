import type { LlmFailure } from "../llm/types.js";
import type { AgentRuntimeLimits } from "./types.js";

const MAX_TIMER_DELAY_MS = 2_147_483_647;
const RETRYABLE_MODEL_FAILURES = new Set([
  "EMPTY_RESPONSE",
  "RATE_LIMIT",
  "SERVER",
  "TIMEOUT",
  "TRANSPORT",
  // Compatibility with the provider-neutral failure emitted by our LLM service.
  "stream-failed",
]);

export const DEFAULT_AGENT_RUNTIME_LIMITS: AgentRuntimeLimits = Object.freeze({
  maxSteps: 150,
  modelTimeoutMs: 300_000,
  maxModelRetries: 5,
});

export function resolveAgentRuntimeLimits(
  defaults: Partial<AgentRuntimeLimits> = {},
  overrides: Partial<AgentRuntimeLimits> = {},
): AgentRuntimeLimits {
  const limits = {
    ...DEFAULT_AGENT_RUNTIME_LIMITS,
    ...defaults,
    ...overrides,
  };
  assertPositiveSafeInteger("maxSteps", limits.maxSteps);
  assertTimerDelay("modelTimeoutMs", limits.modelTimeoutMs);
  if (!Number.isSafeInteger(limits.maxModelRetries)
    || limits.maxModelRetries < 0) {
    throw new RangeError("maxModelRetries must be a non-negative safe integer.");
  }
  return Object.freeze(limits);
}

export interface Deadline {
  readonly signal: AbortSignal;
  readonly timedOut: boolean;
  dispose(): void;
}

/** A disposable child signal that distinguishes its deadline from caller abort. */
export function createDeadline(
  parent: AbortSignal,
  timeoutMs: number,
): Deadline {
  const controller = new AbortController();
  let timedOut = false;
  let disposed = false;
  const onParentAbort = (): void => controller.abort(parent.reason);
  if (parent.aborted) {
    onParentAbort();
  } else {
    parent.addEventListener("abort", onParentAbort, { once: true });
  }
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort(new Error(`Model request timed out after ${timeoutMs}ms.`));
  }, timeoutMs);

  return {
    signal: controller.signal,
    get timedOut() {
      return timedOut;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      clearTimeout(timer);
      parent.removeEventListener("abort", onParentAbort);
    },
  };
}

export function isRetryableModelFailure(failure: LlmFailure): boolean {
  return RETRYABLE_MODEL_FAILURES.has(failure.code);
}

/** Harness-compatible exponential backoff: 500ms..10s with 10% jitter. */
export function modelRetryDelayMs(
  failure: LlmFailure,
  retry: number,
  random = Math.random,
): number | undefined {
  const providerDelay = failure.retryAfterMs;
  if (providerDelay !== undefined) {
    if (!Number.isFinite(providerDelay) || providerDelay <= 0
      || providerDelay > 10_000) {
      return undefined;
    }
    return providerDelay;
  }
  const exponential = Math.min(500 * 2 ** Math.min(retry - 1, 1024), 10_000);
  const jitter = 0.9 + 0.2 * random();
  return Math.min(exponential * jitter, 10_000);
}

export function cancellableDelay(
  delayMs: number,
  signal: AbortSignal,
): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve(true);
    }, delayMs);
    function onAbort(): void {
      clearTimeout(timer);
      resolve(false);
    }
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

export type RetryableAttempt<TValue> =
  | { readonly kind: "completed"; readonly value: TValue }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly failure: LlmFailure };

/** Repeats only transient model failures and keeps cancellation ahead of retry. */
export async function runWithModelRetries<TValue>(
  signal: AbortSignal,
  maxRetries: number,
  attempt: () => Promise<RetryableAttempt<TValue>>,
): Promise<RetryableAttempt<TValue>> {
  for (let retries = 0; ; retries += 1) {
    const result = await attempt();
    if (result.kind !== "failed"
      || retries >= maxRetries
      || !isRetryableModelFailure(result.failure)) {
      return result;
    }
    const delayMs = modelRetryDelayMs(result.failure, retries + 1);
    if (delayMs === undefined) return result;
    if (!await cancellableDelay(delayMs, signal)) return { kind: "cancelled" };
  }
}

function assertPositiveSafeInteger(name: string, value: number): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
}

function assertTimerDelay(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0 || value > MAX_TIMER_DELAY_MS) {
    throw new RangeError(
      `${name} must be greater than zero and at most ${MAX_TIMER_DELAY_MS}.`,
    );
  }
}
