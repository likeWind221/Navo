import { afterEach, describe, expect, it, vi } from "vitest";

import { TEST_TOOL_NAMES, TestTools } from "../src/tools/testing.js";
import {
  createToolTestKit,
  toolCall,
} from "./helpers/tools.js";

const kit = createToolTestKit();
afterEach(async () => {
  vi.useRealTimers();
  await kit.dispose();
});

describe("ToolService cancellation", () => {
  it("does not invoke a tool for a pre-aborted call", async () => {
    const ctx = await kit.createContext();
    let invoked = false;
    ctx.tools.register({
      name: "must_not_run",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        invoked = true;
        return "unexpected";
      },
    });
    const call = toolCall("pre-aborted", "must_not_run", {});

    const result = await ctx.tools.execute(
      call,
      AbortSignal.abort("already cancelled"),
    );

    expect(result).toMatchObject({
      kind: "failure",
      block: { toolCallId: call.id, isError: true },
      failure: { code: "cancelled" },
    });
    expect(invoked).toBe(false);
  });

  it("turns a timeout signal into cancellation and clears owned timers", async () => {
    vi.useFakeTimers();
    const ctx = await kit.createContext();
    await ctx.plugin(TestTools);
    const controller = new AbortController();
    setTimeout(() => controller.abort("tool timeout"), 50);
    const call = toolCall("timeout", TEST_TOOL_NAMES.delay, {
      delayMs: 10_000,
      text: "late",
    });

    const pending = ctx.tools.execute(call, controller.signal);
    await vi.advanceTimersByTimeAsync(50);
    const result = await pending;

    expect(result).toMatchObject({
      kind: "failure",
      block: { toolCallId: call.id, isError: true },
      failure: { code: "cancelled" },
    });
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves success when a tool completes as the signal aborts", async () => {
    const ctx = await kit.createContext();
    const controller = new AbortController();
    ctx.tools.register({
      name: "commit_then_abort",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        controller.abort("stop after committed result");
        return "committed";
      },
    });
    const call = toolCall("commit-then-abort", "commit_then_abort", {});

    const result = await ctx.tools.execute(call, controller.signal);

    expect(result).toEqual({
      kind: "success",
      block: {
        type: "tool-result",
        toolCallId: call.id,
        content: [{ type: "text", text: "committed" }],
        isError: false,
      },
    });
  });

  it("treats an unrelated AbortError as a tool failure", async () => {
    const ctx = await kit.createContext();
    ctx.tools.register({
      name: "internal_abort",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        throw new DOMException("internal timeout", "AbortError");
      },
    });
    const call = toolCall("internal-abort", "internal_abort", {});

    const result = await ctx.tools.execute(
      call,
      new AbortController().signal,
    );

    expect(result).toMatchObject({
      kind: "failure",
      block: { toolCallId: call.id, isError: true },
      failure: { code: "tool-failed", message: "internal timeout" },
    });
  });

});

describe("ToolService execution binding", () => {
  it("keeps a started call bound to the captured definition", async () => {
    const ctx = await kit.createContext();
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const disposeOld = ctx.tools.register({
      name: "replaceable",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        await gate;
        return "old";
      },
    });
    const pending = ctx.tools.execute(
      toolCall("old-call", "replaceable", {}),
      new AbortController().signal,
    );
    disposeOld();
    ctx.tools.register({
      name: "replaceable",
      parameters: { type: "object", properties: {} },
      execute: async () => "new",
    });

    release?.();
    const oldResult = await pending;
    const newResult = await ctx.tools.execute(
      toolCall("new-call", "replaceable", {}),
      new AbortController().signal,
    );

    expect(oldResult.block.content).toEqual([{ type: "text", text: "old" }]);
    expect(newResult.block.content).toEqual([{ type: "text", text: "new" }]);
  });
});
