import { describe, expect, it, vi } from "vitest";
import { createToolCallId } from "../../../src/brand/ids.js";
import { ProjectRuntime } from "../../../src/project/runtime.js";
import { modelResponse } from "../../helpers/runtime.js";
import { createActor, createKit, flushUntil } from "./helpers.js";

describe("ProjectRuntime disposal", () => {
  it("settles Main and Node work before runtime disposal completes and can remount without replay", async () => {
    const { ctx, adapter, runtimeFiber } = await createKit([
      { kind: "hang" }, { kind: "hang" }, modelResponse([{ type: "text", text: "restarted" }]),
    ]);
    const main = createActor(ctx, "main");
    const node = createActor(ctx, "node");
    const runtime = ctx.projectRuntime;
    let settled = 0;
    const first = main.start().finally(() => settled++);
    const second = node.start().finally(() => settled++);
    await flushUntil(() => adapter.requests.length === 2);
    await runtimeFiber.dispose();
    expect(settled).toBe(2);
    await expect(first).resolves.toMatchObject({ turn: { status: "cancelled" } });
    await expect(second).resolves.toMatchObject({ turn: { status: "cancelled" } });
    expect(ctx.nodes.get(node.nodeId!)?.status).toBe("idle");
    expect(runtime.canStartMain(main.project.id)).toBe(false);
    expect(runtime.canContinueNode(node.project.id, node.nodeId!)).toBe(false);
    expect(() => main.next()).toThrow(expect.objectContaining({ code: "runtime-unavailable" }));
    await ctx.plugin(ProjectRuntime);
    expect(adapter.requests).toHaveLength(2);
    await expect(ctx.projectRuntime.continueNode({
      projectId: node.project.id, nodeId: node.nodeId!, text: "Human restart",
    })).resolves.toMatchObject({ turn: { status: "completed" } });
  });

  it.each(["main", "node"] as const)("cancels %s when its Session service is released", async kind => {
    const { ctx, adapter, nodeFiber, mainFiber } = await createKit([{ kind: "hang" }]);
    const actor = createActor(ctx, kind);
    const pending = actor.start();
    await flushUntil(() => adapter.requests.length === 1);
    await (kind === "main" ? mainFiber : nodeFiber).dispose();
    await expect(pending).resolves.toMatchObject({ turn: { status: "cancelled" } });
    if (actor.nodeId) expect(ctx.nodes.get(actor.nodeId)?.status).toBe("idle");
    expect(actor.canContinue()).toBe(false);
    expect(adapter.requests).toHaveLength(1);
  });

  it.each(["model", "tool"] as const)("closes Turn logs and Node work when the whole scope is released during %s", async phase => {
    const calls = () => modelResponse([{
      type: "tool-call", id: createToolCallId("search"), name: "web_search",
      arguments: JSON.stringify({ query: "Evidence" }),
    }], "tool-calls");
    const { ctx, adapter, searchAdapter } = await createKit(
      phase === "model" ? [{ kind: "hang" }, { kind: "hang" }] : [calls(), calls()],
      [{ kind: "hang" }, { kind: "hang" }],
    );
    const main = createActor(ctx, "main");
    const node = createActor(ctx, "node");
    const nodes = ctx.nodes;
    const sessions = ctx.sessions;
    const pending = Promise.allSettled([main.start(), node.start()]);
    await flushUntil(() => adapter.requests.length === 2);
    if (phase === "tool") await vi.waitFor(() => expect(searchAdapter.requests).toHaveLength(2));
    await ctx.fiber.dispose();
    const outcomes = await pending;
    expect(outcomes.map(outcome => outcome.status)).toEqual(["fulfilled", "fulfilled"]);
    expect(nodes.get(node.nodeId!)?.status).toBe("idle");
    for (const outcome of outcomes) {
      if (outcome.status !== "fulfilled") throw outcome.reason;
      expect(outcome.value.turn.status).toBe("cancelled");
      expect(sessions.getEvents(outcome.value.sessionId).filter(event => event.type === "turn-ended")).toHaveLength(1);
      expect(sessions.getEvents(outcome.value.sessionId).filter(event => event.type === "step-ended")).toHaveLength(1);
      if (phase === "tool") {
        expect(sessions.getEvents(outcome.value.sessionId).filter(event => event.type === "tool-call-result")).toHaveLength(1);
      }
    }
    expect(adapter.requests).toHaveLength(2);
  });

  it("settles a Node still waiting to begin without retaining a working state", async () => {
    const { ctx, adapter, runtimeFiber } = await createKit([]);
    const actor = createActor(ctx, "node");
    const outcome = actor.start().then(value => ({ value }), error => ({ error }));
    await runtimeFiber.dispose();
    const result = await outcome;
    if ("value" in result) expect(result.value.turn.status).toBe("cancelled");
    else expect(result.error).toMatchObject({ name: "AbortError" });
    expect(ctx.nodes.get(actor.nodeId!)?.status).toBe("idle");
    expect(adapter.requests).toHaveLength(0);
  });
});
