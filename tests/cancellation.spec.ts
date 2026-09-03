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

  it("returns cancelled results for calls remaining after an abort", async () => {
    vi.useFakeTimers();
    const ctx = await kit.createContext();
    await ctx.plugin(TestTools);
    let laterInvocations = 0;
    ctx.tools.register({
      name: "later",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        laterInvocations += 1;
        return "later";
      },
    });
    const controller = new AbortController();
    const calls = [
      toolCall("delayed", TEST_TOOL_NAMES.delay, {
        delayMs: 10_000,
        text: "late",
      }),
      toolCall("later", "later", {}),
    ];
    const pending = ctx.tools.executeSequential(calls, controller.signal);
    await vi.advanceTimersByTimeAsync(0);

    controller.abort("stop batch");
    const results = await pending;

    expect(results.map((result) => result.kind)).toEqual(["failure", "failure"]);
    expect(results.map((result) => result.block.toolCallId)).toEqual(
      calls.map((call) => call.id),
    );
    expect(results.map((result) =>
      result.kind === "failure" ? result.failure.code : undefined))
      .toEqual(["cancelled", "cancelled"]);
    expect(laterInvocations).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("ToolService sequential execution", () => {
  it("keeps a completed call successful and cancels later calls", async () => {
    const ctx = await kit.createContext();
    const controller = new AbortController();
    let laterInvocations = 0;
    ctx.tools.register({
      name: "finish_and_stop",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        controller.abort("stop remaining calls");
        return "finished";
      },
    });
    ctx.tools.register({
      name: "must_not_follow",
      parameters: { type: "object", properties: {} },
      execute: async () => {
        laterInvocations += 1;
        return "unexpected";
      },
    });
    const calls = [
      toolCall("finished", "finish_and_stop", {}),
      toolCall("not-started", "must_not_follow", {}),
    ];

    const results = await ctx.tools.executeSequential(calls, controller.signal);

    expect(results[0]).toMatchObject({
      kind: "success",
      block: { toolCallId: calls[0]!.id, isError: false },
    });
    expect(results[1]).toMatchObject({
      kind: "failure",
      block: { toolCallId: calls[1]!.id, isError: true },
      failure: { code: "cancelled" },
    });
    expect(laterInvocations).toBe(0);
  });

  it("does not start the next call before the prior call settles", async () => {
    const ctx = await kit.createContext();
    const events: string[] = [];
    let releaseFirst: (() => void) | undefined;
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    ctx.tools.register({
      name: "ordered",
      parameters: {
        type: "object",
        properties: { label: { type: "string" } },
        required: ["label"],
      },
      async execute(arguments_) {
        const label = String(arguments_.label);
        events.push(`${label}:start`);
        if (label === "first") await firstGate;
        events.push(`${label}:end`);
        return label;
      },
    });
    const calls = [
      toolCall("first", "ordered", { label: "first" }),
      toolCall("second", "ordered", { label: "second" }),
    ];

    const pending = ctx.tools.executeSequential(
      calls,
      new AbortController().signal,
    );
    expect(events).toEqual(["first:start"]);
    releaseFirst?.();
    const results = await pending;

    expect(events).toEqual([
      "first:start", "first:end", "second:start", "second:end",
    ]);
    expect(results.map((result) => result.block.toolCallId)).toEqual(
      calls.map((call) => call.id),
    );
  });

  it("continues after a business failure while preserving model order", async () => {
    const ctx = await kit.createContext();
    await ctx.plugin(TestTools);
    const calls = [
      toolCall("one", TEST_TOOL_NAMES.echo, { text: "one" }),
      toolCall("two", TEST_TOOL_NAMES.fail, {}),
      toolCall("three", TEST_TOOL_NAMES.echo, { text: "three" }),
    ];

    const results = await ctx.tools.executeSequential(
      calls,
      new AbortController().signal,
    );

    expect(results.map((result) => result.kind)).toEqual([
      "success", "failure", "success",
    ]);
    expect(results.map((result) => result.block.toolCallId)).toEqual(
      calls.map((call) => call.id),
    );
  });

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
