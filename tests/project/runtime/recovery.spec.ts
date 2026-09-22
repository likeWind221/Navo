import { describe, expect, it, vi } from "vitest";
import { createToolCallId } from "../../../src/brand/ids.js";
import { modelError, modelResponse } from "../../helpers/runtime.js";
import { createActor, createKit, flushUntil } from "./helpers.js";

const done = () => modelResponse([{ type: "text", text: "done" }]);
const search = () => modelResponse([{
  type: "tool-call", id: createToolCallId("search"), name: "web_search",
  arguments: JSON.stringify({ query: "Evidence" }),
}], "tool-calls");

describe.each(["main", "node"] as const)("ProjectRuntime %s recovery", kind => {
  it("closes a model failure and requires another Human action to recover", async () => {
    const { ctx, adapter } = await createKit([modelError("MODEL"), done()]);
    const actor = createActor(ctx, kind);
    const history = ctx.projects.getEvents(actor.project.id);
    const first = await actor.start();
    expect(first.turn).toMatchObject({ status: "failed", failure: { code: "MODEL" } });
    expect(actor.canContinue()).toBe(true);
    if (actor.nodeId) expect(ctx.nodes.get(actor.nodeId)?.status).toBe("idle");
    expect(ctx.projects.getEvents(actor.project.id)).toEqual(history);
    const events = ctx.sessions.getEvents(first.sessionId);
    expect(events.filter(event => event.type === "turn-started")).toHaveLength(1);
    expect(events.filter(event => event.type === "turn-ended")).toHaveLength(1);
    await Promise.resolve();
    expect(adapter.requests).toHaveLength(1);
    const next = await actor.next();
    expect(next.sessionId).toBe(first.sessionId);
    expect(next.turn.status).toBe("completed");
    expect(adapter.requests).toHaveLength(2);
  });

  it("returns Tool failure to the same Turn and releases it after the model responds", async () => {
    const { ctx, adapter, searchAdapter } = await createKit([search(), done(), done()], [
      { kind: "error", error: new Error("search unavailable") },
    ]);
    const actor = createActor(ctx, kind);
    const result = await actor.start();
    expect(result.turn).toMatchObject({ status: "completed", steps: 2 });
    expect(searchAdapter.requests).toHaveLength(1);
    const events = ctx.sessions.getEvents(result.sessionId);
    expect(events.filter(event => event.type === "turn-started")).toHaveLength(1);
    expect(events.filter(event => event.type === "turn-ended")).toHaveLength(1);
    expect(events).toEqual(expect.arrayContaining([
      expect.objectContaining({ type: "error", data: expect.objectContaining({ source: "tool" }) }),
    ]));
    expect(JSON.stringify(adapter.requests[1]?.messages)).toContain("The search request failed.");
    expect(actor.canContinue()).toBe(true);
    expect(adapter.requests).toHaveLength(2);
    await expect(actor.next()).resolves.toMatchObject({ turn: { status: "completed" } });
  });

  it("cancels during Tool execution without opening another model step", async () => {
    const { ctx, adapter, searchAdapter } = await createKit([search(), done()], [{ kind: "hang" }]);
    const actor = createActor(ctx, kind);
    const pending = actor.start();
    await vi.waitFor(() => expect(searchAdapter.requests).toHaveLength(1));
    expect(actor.stop()).toBe(true);
    const result = await pending;
    expect(result.turn.status).toBe("cancelled");
    expect(adapter.requests).toHaveLength(1);
    expect(actor.canContinue()).toBe(true);
    if (actor.nodeId) expect(ctx.nodes.get(actor.nodeId)?.status).toBe("idle");
    const events = ctx.sessions.getEvents(result.sessionId);
    expect(events.filter(event => event.type === "tool-call-result")).toHaveLength(1);
    expect(events.filter(event => event.type === "turn-ended")).toHaveLength(1);
    await expect(actor.next()).resolves.toMatchObject({ turn: { status: "completed" } });
  });

  it("allows cancellation after archive and does not run automatically after reopen", async () => {
    const { ctx, adapter } = await createKit([{ kind: "hang" }, done()]);
    const actor = createActor(ctx, kind);
    const pending = actor.start();
    await flushUntil(() => adapter.requests.length === 1);
    ctx.projects.archive(actor.project.id, "Pause");
    expect(actor.canContinue()).toBe(false);
    expect(() => actor.next()).toThrow(expect.objectContaining({ code: "project-unavailable" }));
    expect(actor.stop()).toBe(true);
    await expect(pending).resolves.toMatchObject({ turn: { status: "cancelled" } });
    if (actor.nodeId) expect(ctx.nodes.get(actor.nodeId)?.status).toBe("idle");
    ctx.projects.reopen(actor.project.id, "Resume");
    await Promise.resolve();
    expect(adapter.requests).toHaveLength(1);
    expect(actor.canContinue()).toBe(true);
    await expect(actor.next()).resolves.toMatchObject({ turn: { status: "completed" } });
  });

  it("settles cancellation racing with model completion exactly once", async () => {
    const controller = new AbortController();
    const { ctx, adapter } = await createKit([{
      kind: "handler",
      *handle() {
        yield* done().events.slice(0, -1);
        controller.abort();
        yield done().events.at(-1)!;
      },
    }, done()]);
    const actor = createActor(ctx, kind);
    const result = await actor.start(controller.signal);
    expect(result.turn.status).toBe("cancelled");
    expect(ctx.sessions.getEvents(result.sessionId).filter(event => event.type === "turn-ended")).toHaveLength(1);
    expect(actor.canContinue()).toBe(true);
    await expect(actor.next()).resolves.toMatchObject({ turn: { status: "completed" } });
    expect(adapter.requests).toHaveLength(2);
  });
});

it("rejects a Node dispatch archived before its queued work begins, without leaving working", async () => {
  const { ctx, adapter } = await createKit([done()]);
  const actor = createActor(ctx, "node");
  const pending = actor.start();
  ctx.projects.archive(actor.project.id, "Before dispatch");
  await expect(pending).rejects.toMatchObject({ code: "project-unavailable" });
  expect(ctx.nodes.get(actor.nodeId!)?.status).toBe("idle");
  expect(adapter.requests).toHaveLength(0);
  ctx.projects.reopen(actor.project.id, "Retry explicitly");
  expect(actor.canContinue()).toBe(true);
  await expect(actor.next()).resolves.toMatchObject({ turn: { status: "completed" } });
});
