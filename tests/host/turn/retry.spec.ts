import { afterEach, describe, expect, it, vi } from "vitest";

import { createAgentTurnHandler } from "../../../src/host/turn.js";
import { createRuntime, disposeRuntimes } from "../../helpers/runtime.js";

afterEach(async () => {
  vi.useRealTimers();
  await disposeRuntimes();
});

const config = { model: { provider: "mock", model: "test" } };

describe("Kernel Host agent.turn retries", () => {
  it("fails an incomplete visible stream without retrying", async () => {
    const kit = await createRuntime([
      {
        kind: "events",
        events: [
          { type: "content-started", contentIndex: 0, contentType: "text" },
          { type: "content-delta", contentIndex: 0, contentType: "text", delta: "partial" },
        ],
      },
      { kind: "events", events: [{ type: "finished", reason: { kind: "stop" } }] },
    ]);

    const events = await run(kit, "broken");

    expect(events.map((event) => event.type)).toEqual([
      "started", "text-delta", "failed",
    ]);
    expect(events.at(-1)).toMatchObject({ failure: { code: "stream-incomplete" } });
    expect(kit.adapter.remainingEntries).toBe(1);
  });

  it("does not retry a provider error after publishing visible text", async () => {
    const kit = await createRuntime([
      {
        kind: "error",
        eventsBeforeError: [
          { type: "content-started", contentIndex: 0, contentType: "text" },
          { type: "content-delta", contentIndex: 0, contentType: "text", delta: "visible" },
        ],
        error: new Error("socket failed"),
      },
      { kind: "events", events: [{ type: "finished", reason: { kind: "stop" } }] },
    ]);

    const events = await run(kit, "published");

    expect(events.at(-1)).toMatchObject({
      type: "failed",
      failure: { code: "stream-output-interrupted" },
    });
    expect(kit.adapter.remainingEntries).toBe(1);
  });

  it("can retry after reasoning that v1 intentionally keeps private", async () => {
    vi.useFakeTimers();
    const kit = await createRuntime([
      {
        kind: "error",
        eventsBeforeError: [
          { type: "content-started", contentIndex: 0, contentType: "reasoning" },
          { type: "content-delta", contentIndex: 0,
            contentType: "reasoning", delta: "private" },
        ],
        error: new Error("socket failed"),
      },
      {
        kind: "events",
        events: [
          { type: "content-started", contentIndex: 0, contentType: "text" },
          { type: "content-delta", contentIndex: 0, contentType: "text", delta: "recovered" },
          { type: "content-completed", contentIndex: 0, contentType: "text" },
          { type: "finished", reason: { kind: "stop" } },
        ],
      },
    ]);

    const pending = run(kit, "private");
    await vi.runAllTimersAsync();
    const events = await pending;

    expect(events.map((event) => event.type)).toEqual([
      "started", "text-delta", "completed",
    ]);
    expect(kit.adapter.remainingEntries).toBe(0);
  });
});

async function run(
  kit: Awaited<ReturnType<typeof createRuntime>>,
  suffix: string,
) {
  const handler = createAgentTurnHandler(kit.ctx, config);
  const events = [];
  for await (const event of handler({
    sessionId: `${suffix}-session`,
    requestId: `${suffix}-request`,
    text: suffix,
  }, new AbortController().signal)) events.push(event);
  return events;
}
