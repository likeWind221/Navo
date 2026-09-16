import { Context } from "cordis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentRuntime } from "../../src/agent/runtime.js";
import { createNodeId, createToolCallId } from "../../src/brand/ids.js";
import { LLMService } from "../../src/llm/service.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import type { ContentBlock, GenerateRequest, ToolCallContentBlock } from "../../src/llm/types.js";
import { createNodeAgentProfile, NODE_AGENT_TOOL_NAMES } from "../../src/node/profile.js";
import { NodeSessionService } from "../../src/node/session.js";
import { NodeStore } from "../../src/node/store.js";
import { ProjectStore } from "../../src/project/store.js";
import { SessionStore } from "../../src/session/store.js";
import { MockFetchCore } from "../../src/tools/builtins/fetch/mock.js";
import { FetchTool } from "../../src/tools/builtins/fetch/tool.js";
import { MockSearchAdapter } from "../../src/tools/builtins/search/adapters/mock.js";
import { SearchTool } from "../../src/tools/builtins/search/tool.js";
import { ToolService } from "../../src/tools/service.js";
import { modelResponse } from "../helpers/runtime.js";

const contexts = new Set<Context>();

afterEach(async () => {
  await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
  contexts.clear();
});

async function createKit(entries: ConstructorParameters<typeof MockLLMAdapter>[0]) {
  const ctx = new Context();
  contexts.add(ctx);
  await ctx.plugin(SessionStore);
  await ctx.plugin(LLMService);
  await ctx.plugin(ToolService);
  await ctx.plugin(AgentRuntime);
  await ctx.plugin(ProjectStore);
  await ctx.plugin(NodeStore);

  await ctx.plugin(SearchTool, { adapter: new MockSearchAdapter([]) });
  await ctx.plugin(FetchTool, { core: new MockFetchCore([]) });
  const adapter = new MockLLMAdapter(entries);
  ctx.llm.registerAdapter("mock", adapter);
  const serviceFiber = await ctx.plugin(NodeSessionService, {
    model: { provider: "mock", model: "node-test" },
  });
  return { ctx, adapter, serviceFiber };
}

function createNode(ctx: Context, title = "Capability") {
  const node = ctx.nodes.create({
    projectId: ctx.projects.create({ goal: title }).id,
    objective: {
      title,
      description: `Learn ${title}`,
      acceptanceCriteria: [`Demonstrate ${title}`],
    },
  });
  return ctx.nodes.unlock(node.node.id, 'Ready');
}

function response(block: ContentBlock, finish: "stop" | "tool-calls" = "stop") {
  return modelResponse([block], finish);
}

function textResponse(text: string) {
  return response({ type: "text", text });
}

function call(id: string, name: string, arguments_: unknown): ToolCallContentBlock {
  return {
    type: "tool-call",
    id: createToolCallId(id),
    name,
    arguments: JSON.stringify(arguments_),
  };
}

function systemText(request: GenerateRequest): string {
  const block = request.messages[0]?.content[0];
  if (request.messages[0]?.role !== "system" || block?.type !== "text") {
    throw new Error("request omitted NodeAgent system profile");
  }
  return block.text;
}

async function flushUntil(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 30 && !condition(); index += 1) await Promise.resolve();
  if (!condition()) throw new Error("expected asynchronous boundary was not reached");
}

describe("NodeSessionService identity and context", () => {
  it("rejects control nodes before session creation or model execution", async () => {
    const { ctx, adapter } = await createKit([]);
    const projectId = ctx.projects.create({ goal: "Project" }).id;
    const id = ctx.nodes.create({ projectId, kind: "control", purpose: "start", title: "Start" }).node.id;
    ctx.nodes.unlock(id, "Ready");
    expect(() => ctx.nodeSessions.start({ nodeId: id, text: "Execute" }))
      .toThrow(expect.objectContaining({ code: "invalid-state" }));
    expect(ctx.nodes.get(id)?.sessionId).toBeUndefined();
    expect(adapter.requests).toHaveLength(0);
  });
  it("creates one Session, reuses it, and retains multi-Turn history", async () => {
    const { ctx, adapter } = await createKit([textResponse("first"), textResponse("second")]);
    const node = createNode(ctx);

    const first = await ctx.nodeSessions.start({ nodeId: node.node.id, text: "start" });
    const second = await ctx.nodeSessions.start({ nodeId: node.node.id, text: "continue" });

    expect(second.sessionId).toBe(first.sessionId);
    expect(ctx.nodes.getEvents(node.node.id).map((event) => event.type))
      .toEqual(["node-created", "node-unlocked", "session-bound", "work-started", "work-ended", "work-started", "work-ended"]);
    expect(adapter.requests[1]?.messages.map((message) => message.role))
      .toEqual(["system", "user", "assistant", "user"]);
    expect(adapter.requests[1]?.messages.flatMap((message) => message.content)
      .filter((block) => block.type === "text").map((block) => block.text))
      .toEqual(expect.arrayContaining(["start", "first", "continue"]));
    expect(adapter.requests[0]?.tools?.map((tool) => tool.name).sort())
      .toEqual([...NODE_AGENT_TOOL_NAMES].sort());
  });

  it("generates a deterministic, delimited Profile without Session identities", async () => {
    const { ctx } = await createKit([]);
    const created = createNode(ctx, "Close </node-context> safely");
    const profile = createNodeAgentProfile(created);

    expect(createNodeAgentProfile(created)).toEqual(profile);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.toolNames)).toBe(true);
    expect(profile.systemPrompt).toContain("Close \\u003c/node-context\\u003e safely");
    expect(profile.systemPrompt).not.toContain(String(created.node.id));
    expect(profile.systemPrompt).not.toContain("sessionId");
  });

  it("keeps different Nodes on isolated Sessions and Profiles", async () => {
    const { ctx, adapter } = await createKit([textResponse("A"), textResponse("B")]);
    const first = createNode(ctx, "Alpha-only");
    const second = createNode(ctx, "Beta-only");

    const [a, b] = await Promise.all([
      ctx.nodeSessions.start({ nodeId: first.node.id, text: "alpha" }),
      ctx.nodeSessions.start({ nodeId: second.node.id, text: "beta" }),
    ]);

    expect(a.sessionId).not.toBe(b.sessionId);
    expect(systemText(adapter.requests[0]!)).toContain("Alpha-only");
    expect(systemText(adapter.requests[0]!)).not.toContain("Beta-only");
    expect(systemText(adapter.requests[1]!)).toContain("Beta-only");
    expect(ctx.sessions.deriveMessages(a.sessionId).some((message) =>
      JSON.stringify(message).includes("beta"))).toBe(false);
  });

  it("rejects invalid entry calls without binding or logging", async () => {
    const { ctx } = await createKit([]);
    const node = createNode(ctx);

    expect(() => ctx.nodeSessions.start({ nodeId: node.node.id, text: " " }))
      .toThrow(expect.objectContaining({ code: "invalid-message" }));
    expect(() => ctx.nodeSessions.sendMessage({ nodeId: node.node.id, text: "hello" }))
      .toThrow(expect.objectContaining({ code: "node-session-required" }));
    expect(() => ctx.nodeSessions.start({ nodeId: createNodeId("missing"), text: "hello" }))
      .toThrow(expect.objectContaining({ code: "node-not-found" }));
    expect(ctx.nodes.getEvents(node.node.id)).toHaveLength(2);
  });
});

describe("NodeSessionService scheduling and lifecycle", () => {
  it.each(["locked", "completing", "archived"])("rechecks %s before executing queued work", async state => {
    const { ctx, adapter } = await createKit([]);
    const node = createNode(ctx);
    const pending = ctx.nodeSessions.start({ nodeId: node.node.id, text: "Queued" });
    if (state === "locked") ctx.nodes.lock(node.node.id, "Wait");
    else if (state === "archived") ctx.projects.archive(node.node.projectId, "Pause");
    else ctx.nodes.confirmCompletion(node.node.id, {
      confirmedBy: "reviewer", reason: "Checked", reviewedRevision: ctx.nodes.get(node.node.id)!.revision,
    });
    await expect(pending).rejects.toMatchObject({ code: state === "archived" ? "project-unavailable" : "invalid-state" });
    expect(adapter.requests).toHaveLength(0);
  });

  it("leaves working state even when Runtime rejects unexpectedly", async () => {
    const { ctx } = await createKit([]);
    const node = createNode(ctx);
    vi.spyOn(ctx.agentRuntime, "runTurn").mockRejectedValueOnce(new Error("runtime rejection"));
    await expect(ctx.nodeSessions.start({ nodeId: node.node.id, text: "Work" })).rejects.toThrow("runtime rejection");
    expect(ctx.nodes.get(node.node.id)?.status).toBe("idle");
    expect(ctx.nodeSessions.stop(node.node.id)).toBe(false);
  });

  it("runs same-Node messages FIFO", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const { ctx, adapter } = await createKit([
      { kind: "handler", handle: async function* () {
        started.resolve();
        await release.promise;
        yield* events("first done");
      } },
      textResponse("second done"),
    ]);
    const node = createNode(ctx);

    const first = ctx.nodeSessions.start({ nodeId: node.node.id, text: "first" });
    await started.promise;
    expect(ctx.nodes.get(node.node.id)?.status).toBe("working");
    const second = ctx.nodeSessions.sendMessage({ nodeId: node.node.id, text: "second" });
    await Promise.resolve();
    expect(adapter.requests).toHaveLength(1);
    release.resolve();
    await Promise.all([first, second]);
    expect(ctx.nodes.get(node.node.id)?.status).toBe("idle");

    expect(adapter.requests.map((request) => request.messages.at(-1)?.content[0]))
      .toEqual([{ type: "text", text: "first" }, { type: "text", text: "second" }]);
  });

  it("cancels only the active Turn and continues queued work", async () => {
    const { ctx, adapter } = await createKit([{ kind: "hang" }, textResponse("survived")]);
    const node = createNode(ctx);
    const first = ctx.nodeSessions.start({ nodeId: node.node.id, text: "cancel me" });
    await flushUntil(() => adapter.requests.length === 1);
    const second = ctx.nodeSessions.sendMessage({ nodeId: node.node.id, text: "keep me" });

    expect(ctx.nodeSessions.stop(node.node.id)).toBe(true);
    await expect(first).resolves.toMatchObject({ turn: { status: "cancelled" } });
    await expect(second).resolves.toMatchObject({ turn: { status: "completed" } });
    expect(ctx.nodes.get(node.node.id)?.status).toBe("idle");
    expect(ctx.nodeSessions.stop(node.node.id)).toBe(false);
    expect(adapter.requests).toHaveLength(2);
  });

  it("allows another Node to run while one Node is blocked", async () => {
    const { ctx, adapter } = await createKit([{ kind: "hang" }, textResponse("B done")]);
    const a = createNode(ctx, "A");
    const b = createNode(ctx, "B");
    const blocked = ctx.nodeSessions.start({ nodeId: a.node.id, text: "block A" });
    await flushUntil(() => adapter.requests.length === 1);

    await expect(ctx.nodeSessions.start({ nodeId: b.node.id, text: "run B" }))
      .resolves.toMatchObject({ turn: { status: "completed" } });
    expect(ctx.nodeSessions.stop(a.node.id)).toBe(true);
    await expect(blocked).resolves.toMatchObject({ turn: { status: "cancelled" } });
  });

  it("returns Runtime failures with a closed Turn log", async () => {
    const { ctx } = await createKit([{
      kind: "events",
      events: [{ type: "finished", reason: { kind: "error", failure: { code: "MODEL", message: "failed" } } }],
    }]);
    const node = createNode(ctx);

    const result = await ctx.nodeSessions.start({ nodeId: node.node.id, text: "fail" });

    expect(result.turn).toMatchObject({ status: "failed", failure: { code: "MODEL" } });
    expect(ctx.nodes.get(node.node.id)?.status).toBe("idle");
    const types = ctx.sessions.getEvents(result.sessionId).map((event) => event.type);
    expect(types[0]).toBe("turn-started");
    expect(types.at(-1)).toBe("turn-ended");
    expect(types.filter((type) => type === "step-started")).toHaveLength(1);
    expect(types.filter((type) => type === "step-ended")).toHaveLength(1);
  });

  it("cancels active work and rejects queued work when unloaded", async () => {
    const { ctx, adapter, serviceFiber } = await createKit([{ kind: "hang" }]);
    const node = createNode(ctx);
    const active = ctx.nodeSessions.start({ nodeId: node.node.id, text: "active" });
    await flushUntil(() => adapter.requests.length === 1);
    const queued = ctx.nodeSessions.sendMessage({ nodeId: node.node.id, text: "queued" });

    await serviceFiber.dispose();

    await expect(active).resolves.toMatchObject({ turn: { status: "cancelled" } });
    await expect(queued).rejects.toMatchObject({ code: "node-session-service-unavailable" });
    expect(adapter.requests).toHaveLength(1);
    expect(Reflect.get(ctx, "nodeSessions")).toBeUndefined();
  });
});

async function* events(text: string) {
  yield { type: "content-started" as const, contentIndex: 0, contentType: "text" as const };
  yield { type: "content-delta" as const, contentIndex: 0,
    contentType: "text" as const, delta: text };
  yield { type: "content-completed" as const, contentIndex: 0, contentType: "text" as const };
  yield { type: "finished" as const, reason: { kind: "stop" as const } };
}
