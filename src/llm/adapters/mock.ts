import type {
  GenerateRequest,
  ModelEvent,
} from "../types.js";
import type { LLMAdapter } from "../adapter.js";

export type MockLLMEntry =
  | MockLLMEventsEntry
  | MockLLMErrorEntry
  | MockLLMHandlerEntry
  | MockLLMHangEntry;

/** Deterministic, queue-driven streaming adapter for tests and simulations. */
export class MockLLMAdapter implements LLMAdapter {
  private readonly queue: MockLLMEntry[];
  private readonly recordedRequests: GenerateRequest[] = [];

  constructor(entries: readonly MockLLMEntry[]) {
    this.queue = [...entries];
  }

  get requests(): readonly GenerateRequest[] {
    return Object.freeze([...this.recordedRequests]);
  }

  get remainingEntries(): number {
    return this.queue.length;
  }

  async *stream(request: GenerateRequest): AsyncIterable<ModelEvent> {
    throwIfAborted(request.signal);
    this.recordedRequests.push(snapshotRequest(request));

    const entry = this.queue.shift();
    if (!entry) {
      throw new MockLLMAdapterError(
        "script-exhausted",
        "Mock LLM stream queue is exhausted.",
      );
    }

    switch (entry.kind) {
      case "events":
        yield* emitEvents(entry.events, entry.eventDelayMs, request.signal);
        return;
      case "error":
        yield* emitEvents(
          entry.eventsBeforeError ?? [],
          entry.eventDelayMs,
          request.signal,
        );
        throw entry.error;
      case "handler":
        yield* emitIterable(entry.handle(request), request.signal);
        return;
      case "hang":
        yield* emitEvents(
          entry.eventsBeforeHang ?? [],
          entry.eventDelayMs,
          request.signal,
        );
        await waitForAbort(request.signal);
        return;
    }
  }
}

export type MockLLMHandler = (
  request: GenerateRequest,
) => Iterable<ModelEvent> | AsyncIterable<ModelEvent>;

export interface MockLLMEventsEntry {
  readonly kind: "events";
  readonly events: readonly ModelEvent[];
  readonly eventDelayMs?: number;
}

export interface MockLLMErrorEntry {
  readonly kind: "error";
  readonly error: unknown;
  readonly eventsBeforeError?: readonly ModelEvent[];
  readonly eventDelayMs?: number;
}

export interface MockLLMHandlerEntry {
  readonly kind: "handler";
  readonly handle: MockLLMHandler;
}

export interface MockLLMHangEntry {
  readonly kind: "hang";
  readonly eventsBeforeHang?: readonly ModelEvent[];
  readonly eventDelayMs?: number;
}

export type MockLLMAdapterErrorCode = "script-exhausted" | "invalid-delay";

export class MockLLMAdapterError extends Error {
  readonly code: MockLLMAdapterErrorCode;

  constructor(code: MockLLMAdapterErrorCode, message: string) {
    super(message);
    this.name = "MockLLMAdapterError";
    this.code = code;
  }
}

async function* emitEvents(
  events: readonly ModelEvent[],
  eventDelayMs = 0,
  signal: AbortSignal | undefined,
): AsyncGenerator<ModelEvent> {
  assertDelay(eventDelayMs);
  for (const event of events) {
    await waitForDelay(eventDelayMs, signal);
    throwIfAborted(signal);
    yield snapshotEvent(event);
  }
}

async function* emitIterable(
  events: Iterable<ModelEvent> | AsyncIterable<ModelEvent>,
  signal: AbortSignal | undefined,
): AsyncGenerator<ModelEvent> {
  for await (const event of events) {
    throwIfAborted(signal);
    yield snapshotEvent(event);
  }
}

function waitForDelay(
  delayMs: number,
  signal: AbortSignal | undefined,
): Promise<void> {
  assertDelay(delayMs);
  throwIfAborted(signal);
  if (delayMs === 0) {
    return Promise.resolve();
  }
  if (signal === undefined) {
    return new Promise<void>((resolve) => setTimeout(resolve, delayMs));
  }

  return new Promise<void>((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(mockAbortError(signal));
    };
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, delayMs);

    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForAbort(signal: AbortSignal | undefined): Promise<never> {
  if (signal === undefined) {
    return new Promise<never>(() => undefined);
  }
  if (signal.aborted) {
    return Promise.reject(mockAbortError(signal));
  }

  return new Promise<never>((_resolve, reject) => {
    signal.addEventListener(
      "abort",
      () => reject(mockAbortError(signal)),
      { once: true },
    );
  });
}

function assertDelay(delayMs: number): void {
  if (!Number.isFinite(delayMs) || delayMs < 0) {
    throw new MockLLMAdapterError(
      "invalid-delay",
      `Mock LLM chunk delay must be a finite non-negative number; received ${delayMs}.`,
    );
  }
}

function throwIfAborted(signal: AbortSignal | undefined): void {
  if (signal?.aborted) {
    throw mockAbortError(signal);
  }
}

function mockAbortError(signal: AbortSignal): Error {
  const error = new Error("Mock LLM stream was aborted.", {
    cause: signal.reason,
  });
  error.name = "AbortError";
  return error;
}

function snapshotRequest(request: GenerateRequest): GenerateRequest {
  const { signal, ...payload } = request;
  const snapshot = deepFreeze(structuredClone(payload));
  return Object.freeze({
    ...snapshot,
    ...(signal === undefined ? {} : { signal }),
  });
}

function snapshotEvent(event: ModelEvent): ModelEvent {
  return deepFreeze(structuredClone(event));
}

function deepFreeze<TValue>(
  value: TValue,
  seen = new Set<object>(),
): TValue {
  if (value === null || typeof value !== "object" || seen.has(value)) {
    return value;
  }

  seen.add(value);
  for (const child of Object.values(value)) {
    deepFreeze(child, seen);
  }
  return Object.freeze(value) as TValue;
}
