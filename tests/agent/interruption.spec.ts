import { afterEach, describe, expect, it, vi } from "vitest";

import { createToolCallId } from "../../src/brand/ids.js";
import type { TurnEvent } from "../../src/agent/types.js";
import type { ModelEvent } from "../../src/llm/types.js";
import { assertClosed, createRuntime, disposeRuntimes, eventTypes,
  modelResponse, turnInput } from "../helpers/runtime.js";

afterEach(async () => {
  vi.useRealTimers();
  await disposeRuntimes();
});

describe("interrupted model attempts", () => {
  it.each(["unobserved", "hidden", "published"] as const)(
    "retries a deadline only before publication: %s", async (visibility) => {
      vi.useFakeTimers();
      const kit = await createRuntime([
        { kind: "hang", eventsBeforeHang: [
          { type: "content-started", contentIndex: 0, contentType: "text" },
          { type: "content-delta", contentIndex: 0, contentType: "text", delta: "prefix" },
        ] },
        modelResponse([{ type: "text", text: "recovered" }]),
      ]);
      const starts: number[] = [];
      const pending = kit.ctx.agentRuntime.runTurn({
        ...turnInput(visibility), limits: { modelTimeoutMs: 50, maxModelRetries: 1 },
        ...(visibility === "unobserved" ? {} : { onEvent(event: TurnEvent) {
          if (event.type === "content-started") starts.push(event.contentIndex);
          return visibility === "published";
        } }),
      });
      await vi.runAllTimersAsync();
      expect(await pending).toMatchObject(visibility === "published"
        ? { status: "failed", failure: { code: "stream-output-interrupted" } }
        : { status: "completed" });
      expect(kit.adapter.requests).toHaveLength(visibility === "published" ? 1 : 2);
      if (visibility === "published") expect(starts).toEqual([0]);
      assertClosed(kit, visibility);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each(["error", "cancelled", "timeout"] as const)(
    "does not assemble or execute a nameless call on %s", async (kind) => {
      vi.useFakeTimers();
      const events: ModelEvent[] = [{ type: "content-started", contentIndex: 0,
        contentType: "tool-call", toolCallId: createToolCallId("partial") }];
      const kit = await createRuntime([kind === "timeout"
        ? { kind: "hang", eventsBeforeHang: events }
        : { kind: "events", events: [...events, { type: "finished", reason: kind === "error"
          ? { kind: "error", failure: { code: "SERVER", message: "original error" } }
          : { kind: "cancelled" } }] }]);
      const pending = kit.ctx.agentRuntime.runTurn({
        ...turnInput(kind), limits: { modelTimeoutMs: 50, maxModelRetries: 0 },
      });
      await vi.runAllTimersAsync();
      expect(await pending).toMatchObject(kind === "cancelled"
        ? { status: "cancelled" }
        : { status: "failed", failure: { code: kind === "timeout" ? "TIMEOUT" : "SERVER" } });
      expect(eventTypes(kit, kind)).not.toContain("tool-call-started");
      expect(eventTypes(kit, kind)).not.toContain("assistant-message");
      assertClosed(kit, kind);
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("keeps caller cancellation ahead of an elapsed deadline after publication", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const kit = await createRuntime([{ kind: "hang", eventsBeforeHang: [
      { type: "content-started", contentIndex: 0, contentType: "tool-call",
        toolCallId: createToolCallId("cancelled-call") },
    ] }]);
    const pending = kit.ctx.agentRuntime.runTurn({
      ...turnInput("priority"), signal: controller.signal,
      limits: { modelTimeoutMs: 50, maxModelRetries: 1 },
      async onEvent(event) {
        if (event.type === "content-started") {
          await vi.advanceTimersByTimeAsync(50);
          controller.abort();
        }
      },
    });
    await expect(pending).resolves.toMatchObject({ status: "cancelled" });
    expect(kit.adapter.requests).toHaveLength(1);
    assertClosed(kit, "priority");
    expect(vi.getTimerCount()).toBe(0);
  });
});
