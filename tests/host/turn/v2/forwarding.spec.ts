import { afterEach, describe, expect, it, vi } from "vitest";
import type { TurnEvent } from "../../../../shared/content.js";
import { createAgentTurnV2Handler } from "../../../../src/host/turn/v2.js";
import { createRuntime, disposeRuntimes, modelResponse } from "../../../helpers/runtime.js";

afterEach(async () => {
  vi.restoreAllMocks();
  await disposeRuntimes();
});

const input = { sessionId: "forward", requestId: "request", text: "hello" };
const config = { model: { provider: "mock", model: "test" } };

describe("v2 Host forwarding", () => {
  it("forwards the exact event objects produced by Runtime", async () => {
    const kit = await createRuntime([modelResponse([{ type: "text", text: "hello" }])]);
    const observed: TurnEvent[] = [];
    const runTurn = kit.ctx.agentRuntime.runTurn.bind(kit.ctx.agentRuntime);
    vi.spyOn(kit.ctx.agentRuntime, "runTurn").mockImplementation(input => runTurn({
      ...input,
      onEvent(event) {
        observed.push(event);
        return input.onEvent?.(event);
      },
    }));
    const forwarded: TurnEvent[] = [];
    for await (const event of createAgentTurnV2Handler(kit.ctx, config)(input, new AbortController().signal)) {
      forwarded.push(event);
    }
    expect(forwarded.length).toBeGreaterThan(0);
    expect(forwarded).toHaveLength(observed.length);
    forwarded.forEach((event, index) => expect(event).toBe(observed[index]));
  });

  it("forwards the trusted tool selection to Runtime", async () => {
    const kit = await createRuntime([modelResponse([{ type: "text", text: "hello" }])]);
    let selected: readonly string[] | undefined;
    const runTurn = kit.ctx.agentRuntime.runTurn.bind(kit.ctx.agentRuntime);
    vi.spyOn(kit.ctx.agentRuntime, "runTurn").mockImplementation(input => {
      selected = input.toolNames;
      return runTurn(input);
    });
    const handler = createAgentTurnV2Handler(kit.ctx, {
      ...config,
      toolNames: ["web_search"],
    });
    for await (const event of handler(input, new AbortController().signal)) void event;
    expect(selected).toEqual(["web_search"]);
  });

  it("propagates a Runtime rejection without inventing a business terminal", async () => {
    const kit = await createRuntime([]);
    const failure = new Error("runtime rejected");
    vi.spyOn(kit.ctx.agentRuntime, "runTurn").mockRejectedValue(failure);
    const iterator = createAgentTurnV2Handler(kit.ctx, config)(input, new AbortController().signal);
    await expect(iterator[Symbol.asyncIterator]().next()).rejects.toBe(failure);
  });

  it("cancels the model when the consumer closes its stream early", async () => {
    const kit = await createRuntime([{ kind: "hang", eventsBeforeHang: [
      { type: "content-started", contentIndex: 0, contentType: "text" },
      { type: "content-delta", contentIndex: 0, contentType: "text", delta: "prefix" },
    ] }]);
    const iterator = createAgentTurnV2Handler(kit.ctx, config)(
      input, new AbortController().signal,
    )[Symbol.asyncIterator]();
    for (let count = 0; count < 4; count++) await iterator.next();
    await iterator.return?.();
    expect(kit.adapter.requests[0]?.signal?.aborted).toBe(true);
  });
});
