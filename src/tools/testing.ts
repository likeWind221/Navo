import type { Context } from "cordis";

import type { ToolRegistration } from "./types.js";

export const TEST_TOOL_NAMES = Object.freeze({
  echo: "test_echo",
  fail: "test_fail",
  delay: "test_delay",
} as const);

/** Explicit-only deterministic tools used by Tool Service and Agent tests. */
export const TestTools = Object.assign(
  (ctx: Context): (() => void) => {
    const registrations: ToolRegistration[] = [];
    try {
      registrations.push(ctx.tools.register({
        name: TEST_TOOL_NAMES.echo,
        description: "Return the provided text unchanged.",
        parameters: {
          type: "object",
          properties: { text: { type: "string" } },
          required: ["text"],
          additionalProperties: false,
        },
        execute: async (arguments_) => ({ content: String(arguments_.text) }),
      }));
      registrations.push(ctx.tools.register({
        name: TEST_TOOL_NAMES.fail,
        description: "Fail with a deterministic test error.",
        parameters: {
          type: "object",
          properties: {},
          additionalProperties: false,
        },
        execute: async () => {
          throw new Error("Test tool failed.");
        },
      }));
      registrations.push(ctx.tools.register({
        name: TEST_TOOL_NAMES.delay,
        description: "Return text after a cooperatively cancellable delay.",
        parameters: {
          type: "object",
          properties: {
            delayMs: { type: "integer" },
            text: { type: "string" },
          },
          required: ["delayMs", "text"],
          additionalProperties: false,
        },
        async execute(arguments_, { signal }) {
          const delayMs = arguments_.delayMs;
          if (typeof delayMs !== "number" || delayMs < 0) {
            throw new TypeError("delayMs must be a non-negative integer.");
          }
          await cancellableDelay(delayMs, signal);
          return { content: String(arguments_.text) };
        },
      }));
    } catch (error: unknown) {
      disposeAll(registrations);
      throw error;
    }

    return () => disposeAll(registrations);
  },
  { inject: ["tools"] },
);

function cancellableDelay(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(abortError(signal.reason));

  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (settle: () => void): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      settle();
    };
    const onAbort = (): void => {
      finish(() => reject(abortError(signal.reason)));
    };
    const timer = setTimeout(() => finish(resolve), delayMs);
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

function abortError(cause: unknown): DOMException {
  const error = new DOMException("Test tool delay was aborted.", "AbortError");
  if (cause !== undefined) {
    Object.defineProperty(error, "cause", { value: cause });
  }
  return error;
}

function disposeAll(registrations: ToolRegistration[]): void {
  for (const dispose of registrations.splice(0).reverse()) dispose();
}
