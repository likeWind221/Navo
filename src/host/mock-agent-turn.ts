import type { AgentTurnEvent, AgentTurnInput } from "../../rpc/agent.js";
import type { RpcStreamHandler } from "../../rpc/stream-rpc.js";

export type MockHostMode = "completed" | "failed" | "truncated" | "hang" | "crash";

export interface MockAgentTurnConfig {
  readonly mode: MockHostMode;
  readonly text: string;
  readonly chunkChars: number;
  readonly delayMs: number;
  readonly crash?: () => never;
}

/** Deterministic agent.turn stream for Electron transport and lifecycle tests. */
export function createMockAgentTurnHandler(
  config: MockAgentTurnConfig,
): RpcStreamHandler<AgentTurnInput, AgentTurnEvent> {
  return async function* mockAgentTurn(input, signal) {
    yield { type: "started", turnId: `mock-${input.requestId}`.slice(0, 128) };
    const text = config.text.replaceAll("{{input}}", input.text);
    for (let offset = 0; offset < text.length; offset += config.chunkChars) {
      if (!await delay(config.delayMs, signal)) {
        yield { type: "cancelled" };
        return;
      }
      yield { type: "text-delta", text: text.slice(offset, offset + config.chunkChars) };
    }
    if (config.mode === "crash") {
      (config.crash ?? (() => { throw new Error("Mock Host crash requested."); }))();
    }
    if (config.mode === "hang") {
      await waitForAbort(signal);
      yield { type: "cancelled" };
      return;
    }
    if (config.mode === "failed") {
      yield {
        type: "failed",
        failure: { code: "mock-failure", message: "Mock Agent failed.", details: {} },
      };
      return;
    }
    yield { type: config.mode === "truncated" ? "truncated" : "completed" };
  };
}

/** Parse a bounded deterministic scenario from the Mock Host environment. */
export function resolveMockAgentTurnConfig(
  env: NodeJS.ProcessEnv = process.env,
  crash?: () => never,
): MockAgentTurnConfig {
  const mode = env.SKILLWORLD_MOCK_MODE ?? "completed";
  if (!isMode(mode)) throw new TypeError("SKILLWORLD_MOCK_MODE is invalid.");
  const chunkChars = positiveInteger(env.SKILLWORLD_MOCK_CHUNK_CHARS, 8);
  const delayMs = nonNegativeInteger(env.SKILLWORLD_MOCK_DELAY_MS, 0);
  const text = env.SKILLWORLD_MOCK_TEXT ?? "Mock reply: {{input}}";
  return Object.freeze({ mode, text, chunkChars, delayMs, ...(crash === undefined ? {} : { crash }) });
}

function delay(durationMs: number, signal: AbortSignal): Promise<boolean> {
  if (signal.aborted) return Promise.resolve(false);
  if (durationMs === 0) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => finish(true), durationMs);
    const onAbort = (): void => finish(false);
    const finish = (completed: boolean): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      resolve(completed);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => signal.addEventListener("abort", () => resolve(), { once: true }));
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > 16_384) {
    throw new TypeError("Mock chunk size must be an integer from 1 through 16384.");
  }
  return parsed;
}

function nonNegativeInteger(value: string | undefined, fallback: number): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 0 || parsed > 60_000) {
    throw new TypeError("Mock delay must be an integer from 0 through 60000.");
  }
  return parsed;
}

function isMode(value: string): value is MockHostMode {
  return value === "completed" || value === "failed" || value === "truncated"
    || value === "hang" || value === "crash";
}
