import { FetchCore } from "./core.js";
import type { FetchCoreConfig } from "./validation.js";
import type { FetchRequest, FetchResult } from "./types.js";

export type MockFetchEntry =
  | { readonly kind: "result"; readonly result: FetchResult }
  | { readonly kind: "error"; readonly error: unknown }
  | { readonly kind: "hang" };

interface MockState {
  readonly entries: readonly MockFetchEntry[];
  readonly requests: FetchRequest[];
  cursor: number;
}

/** Deterministic FetchCore whose anonymous operation is driven by a script. */
export class MockFetchCore extends FetchCore {
  private readonly state: MockState;

  constructor(
    entries: readonly MockFetchEntry[],
    config: FetchCoreConfig = {},
  ) {
    const state: MockState = {
      entries: Object.freeze(entries.map(snapshotEntry)),
      requests: [],
      cursor: 0,
    };
    super((request, signal) => runMock(state, request, signal), config);
    this.state = state;
  }

  get requests(): readonly FetchRequest[] {
    return Object.freeze([...this.state.requests]);
  }

  get remainingEntries(): number {
    return this.state.entries.length - this.state.cursor;
  }
}

async function runMock(
  state: MockState,
  request: FetchRequest,
  signal: AbortSignal,
): Promise<unknown> {
  if (signal.aborted) throw abortError(signal);
  state.requests.push(Object.freeze(structuredClone(request)));
  const entry = state.entries[state.cursor];
  if (entry === undefined) throw new Error("Mock Fetch script is exhausted.");
  state.cursor += 1;
  if (entry.kind === "result") return structuredClone(entry.result);
  if (entry.kind === "error") throw entry.error;
  return await waitForAbort(signal);
}

function snapshotEntry(entry: MockFetchEntry): MockFetchEntry {
  if (entry.kind === "result") {
    return Object.freeze({ kind: "result", result: structuredClone(entry.result) });
  }
  if (entry.kind === "error") {
    return Object.freeze({ kind: "error", error: entry.error });
  }
  return Object.freeze({ kind: "hang" });
}

function waitForAbort(signal: AbortSignal): Promise<never> {
  if (signal.aborted) return Promise.reject(abortError(signal));
  return new Promise<never>((_resolve, reject) => {
    const abort = (): void => {
      signal.removeEventListener("abort", abort);
      reject(abortError(signal));
    };
    signal.addEventListener("abort", abort, { once: true });
  });
}

function abortError(signal: AbortSignal): Error {
  const error = new Error("Mock Fetch was cancelled.", { cause: signal.reason });
  error.name = "AbortError";
  return error;
}
