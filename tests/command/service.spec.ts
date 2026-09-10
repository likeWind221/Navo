import { afterEach, describe, expect, it, vi } from "vitest";

import { CommandError } from "../../src/command/errors.js";
import type { CommandEvent } from "../../shared/content.js";
import { createSessionId } from "../../src/brand/ids.js";
import { createRuntime, disposeRuntimes, modelResponse, turnInput } from "../helpers/runtime.js";
import { createSessionCommandHandler } from "../../src/host/command.js";

afterEach(disposeRuntimes);

describe("CommandService", () => {
  it("runs hello as a sidecar and anchors to the active turn", async () => {
    const kit = await createRuntime([{ kind: "hang" }]);
    const input = turnInput("hello-active");
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const running = kit.ctx.agentRuntime.runTurn({
      ...input,
      signal: controller.signal,
      onEvent(event) {
        if (event.type === "turn-started") started.resolve();
      },
    });
    await started.promise;
    const events: CommandEvent[] = [];
    await kit.ctx.commands.execute({
      sessionId: input.sessionId,
      commandId: "hello-1",
      name: "hello",
      args: "",
    }, event => { events.push(event); }, new AbortController().signal);
    expect(events).toEqual([
      {
        type: "command-started",
        sessionId: input.sessionId,
        commandId: "hello-1",
        name: "hello",
        anchor: { kind: "turn", turnId: expect.any(String) },
      },
      {
        type: "command-completed",
        sessionId: input.sessionId,
        commandId: "hello-1",
        name: "hello",
        anchor: { kind: "turn", turnId: expect.any(String) },
        summary: "hello",
      },
    ]);
    expect(events[0]?.anchor).toEqual(events[1]?.anchor);
    controller.abort();
    await running;
  });

  it("anchors hello to the last turn or the session when idle", async () => {
    const kit = await createRuntime([modelResponse([{ type: "text", text: "ok" }])]);
    const input = turnInput("hello-idle");
    await kit.ctx.agentRuntime.runTurn(input);
    const afterTurn: CommandEvent[] = [];
    await kit.ctx.commands.execute({
      sessionId: input.sessionId,
      commandId: "hello-2",
      name: "hello",
      args: "",
    }, event => { afterTurn.push(event); }, new AbortController().signal);
    expect(afterTurn[0]?.anchor.kind).toBe("turn");

    const empty: CommandEvent[] = [];
    await kit.ctx.commands.execute({
      sessionId: createSessionId("hello-empty"),
      commandId: "hello-3",
      name: "hello",
      args: "",
    }, event => { empty.push(event); }, new AbortController().signal);
    expect(empty[0]?.anchor).toEqual({ kind: "session" });
  });

  it("streams hello through the Host command handler", async () => {
    const kit = await createRuntime([]);
    const events: CommandEvent[] = [];
    for await (const event of createSessionCommandHandler(kit.ctx)({
      sessionId: "host-command", commandId: "host-command-1", name: "hello", args: "",
    }, new AbortController().signal)) events.push(event);
    expect(events.map(event => event.type)).toEqual(["command-started", "command-completed"]);
    expect(events[1]).toMatchObject({ summary: "hello", anchor: { kind: "session" } });
  });

  it("queues stateful commands ahead of later turns", async () => {
    const kit = await createRuntime([
      { kind: "hang" },
      modelResponse([{ type: "text", text: "next" }]),
    ]);
    const input = turnInput("queued-command");
    const controller = new AbortController();
    const firstStarted = Promise.withResolvers<void>();
    const first = kit.ctx.agentRuntime.runTurn({ ...input, signal: controller.signal,
      onEvent(event) {
        if (event.type === "turn-started") firstStarted.resolve();
      },
    });
    await firstStarted.promise;
    await vi.waitFor(() => expect(kit.adapter.requests).toHaveLength(1));
    const order: string[] = [];
    const unregister = kit.ctx.commands.register({
      name: "queued-test",
      mode: "queued",
      execute: () => {
        order.push("command");
        return "done";
      },
    });
    const command = kit.ctx.commands.execute({
      sessionId: input.sessionId,
      commandId: "queued-1",
      name: "queued-test",
      args: "",
    }, event => {
      if (event.type === "command-started") order.push("started");
    }, new AbortController().signal);
    const second = kit.ctx.agentRuntime.runTurn({
      ...turnInput("queued-command-next"),
      sessionId: input.sessionId,
      onEvent(event) {
        if (event.type === "turn-started") order.push("second");
      },
    });
    controller.abort();
    await first;
    await command;
    await second;
    unregister();
    expect(order).toEqual(["started", "command", "second"]);
  });

  it("reports unknown commands and invalid hello arguments", async () => {
    const kit = await createRuntime([]);
    const events: CommandEvent[] = [];
    await kit.ctx.commands.execute({
      sessionId: createSessionId("command-errors"),
      commandId: "unknown-1",
      name: "missing",
      args: "",
    }, event => { events.push(event); }, new AbortController().signal);
    expect(events[0]).toMatchObject({ type: "command-failed", failure: { code: "unknown-command" } });
    events.length = 0;
    await kit.ctx.commands.execute({
      sessionId: createSessionId("command-errors"),
      commandId: "hello-4",
      name: "hello",
      args: "x",
    }, event => { events.push(event); }, new AbortController().signal);
    expect(events[0]).toMatchObject({ type: "command-failed", failure: { code: "invalid-args" } });
    events.length = 0;
    const cancelled = new AbortController();
    cancelled.abort();
    await kit.ctx.commands.execute({
      sessionId: createSessionId("command-errors"),
      commandId: "hello-5",
      name: "hello",
      args: "",
    }, event => { events.push(event); }, cancelled.signal);
    expect(events[0]).toMatchObject({ type: "command-cancelled" });
    expect(() => kit.ctx.commands.register({ name: "HELLO", mode: "sidecar", execute: () => undefined }))
      .toThrow(CommandError);
    expect(() => kit.ctx.commands.register({ name: "broken", mode: "sidecar", execute: undefined as never }))
      .toThrow(CommandError);
  });
});
