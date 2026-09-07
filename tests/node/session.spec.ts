import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../../src/agent/runtime.js";
import { createNodeId, createToolCallId } from "../../src/brand/ids.js";
import { LLMService } from "../../src/llm/service.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import type { GenerateRequest, StreamContentBlock, ToolCallContentBlock } from "../../src/llm/types.js";
import { createNodeAgentProfile, NODE_AGENT_TOOL_NAMES } from "../../src/node/profile.js";
import { NodeSessionService } from "../../src/node/session.js";
import { NodeStore } from "../../src/node/store.js";
import { NODE_CONTENT_TOOL_NAMES, NodeContentTools } from "../../src/node/tools.js";
import { SessionStore } from "../../src/session/store.js";
import { MockFetchCore } from "../../src/tools/builtins/fetch/mock.js";
import { FetchTool } from "../../src/tools/builtins/fetch/tool.js";
import { MockSearchAdapter } from "../../src/tools/builtins/search/adapters/mock.js";
import { SearchTool } from "../../src/tools/builtins/search/tool.js";
import { ToolService } from "../../src/tools/service.js";

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
  await ctx.plugin(NodeStore);
  await ctx.plugin(NodeContentTools);
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
  return ctx.nodes.create({
    capability: {
      title,
      description: `Learn ${title}`,
      successCriteria: [`Demonstrate ${title}`],
    },
  });
}

function response(block: StreamContentBlock, finish: "stop" | "tool-calls" = "stop") {
  return {
    kind: "chunks" as const,
    chunks: [
      { type: "block-end" as const, index: 0, block },
      { type: "finish" as const, reason: { kind: finish } },
    ],
  };
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
  it("creates one Session, reuses it, and retains multi-Turn history", async () => {
    const { ctx, adapter } = await createKit([textResponse("first"), textResponse("second")]);
    const node = createNode(ctx);

    const first = await ctx.nodeSessions.startLearning({ nodeId: node.node.id, text: "start" });
    const second = await ctx.nodeSessions.startLearning({ nodeId: node.node.id, text: "continue" });

    expect(second.sessionId).toBe(first.sessionId);
    expect(ctx.nodes.getEvents(node.node.id).map((event) => event.type))
      .toEqual(["node-created", "session-bound"]);
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

  it("refreshes material and exercises after structured tool updates", async () => {
    const material = call("material", NODE_CONTENT_TOOL_NAMES.replaceMaterial, {
      text: "Fresh material", sources: [{ reference: "https://source.test" }],
    });
    const exercises = call("exercises", NODE_CONTENT_TOOL_NAMES.replaceExerciseSet, {
      exercises: [{ prompt: "Fresh question", referenceAnswer: "Private answer" }],
    });
    const { ctx, adapter } = await createKit([
      response(material, "tool-calls"), response(exercises, "tool-calls"),
      textResponse("content ready"), textResponse("followup"),
    ]);
    const node = createNode(ctx);

    await ctx.nodeSessions.startLearning({ nodeId: node.node.id, text: "create content" });
    await ctx.nodeSessions.sendMessage({ nodeId: node.node.id, text: "use latest" });

    const profile = systemText(adapter.requests[3]!);
    expect(profile).toContain("Fresh material");
    expect(profile).toContain("Fresh question");
    expect(profile).toContain("Private answer");
    expect(ctx.nodes.get(node.node.id)?.revision).toBe(4);
  });

  it("keeps different Nodes on isolated Sessions and Profiles", async () => {
    const { ctx, adapter } = await createKit([textResponse("A"), textResponse("B")]);
    const first = createNode(ctx, "Alpha-only");
    const second = createNode(ctx, "Beta-only");

    const [a, b] = await Promise.all([
      ctx.nodeSessions.startLearning({ nodeId: first.node.id, text: "alpha" }),
      ctx.nodeSessions.startLearning({ nodeId: second.node.id, text: "beta" }),
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

    expect(() => ctx.nodeSessions.startLearning({ nodeId: node.node.id, text: " " }))
      .toThrow(expect.objectContaining({ code: "invalid-message" }));
    expect(() => ctx.nodeSessions.sendMessage({ nodeId: node.node.id, text: "hello" }))
      .toThrow(expect.objectContaining({ code: "node-session-required" }));
    expect(() => ctx.nodeSessions.startLearning({ nodeId: createNodeId("missing"), text: "hello" }))
      .toThrow(expect.objectContaining({ code: "node-not-found" }));
    expect(ctx.nodes.getEvents(node.node.id)).toHaveLength(1);
  });
});

describe("NodeSessionService scheduling and lifecycle", () => {
  it("runs same-Node messages FIFO", async () => {
    const started = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const { ctx, adapter } = await createKit([
      { kind: "handler", handle: async function* () {
        started.resolve();
        await release.promise;
        yield* chunks("first done");
      } },
      textResponse("second done"),
    ]);
    const node = createNode(ctx);

    const first = ctx.nodeSessions.startLearning({ nodeId: node.node.id, text: "first" });
    await started.promise;
    const second = ctx.nodeSessions.sendMessage({ nodeId: node.node.id, text: "second" });
    await Promise.resolve();
    expect(adapter.requests).toHaveLength(1);
    release.resolve();
    await Promise.all([first, second]);

    expect(adapter.requests.map((request) => request.messages.at(-1)?.content[0]))
      .toEqual([{ type: "text", text: "first" }, { type: "text", text: "second" }]);
  });

  it("cancels only the active Turn and continues queued work", async () => {
    const { ctx, adapter } = await createKit([{ kind: "hang" }, textResponse("survived")]);
    const node = createNode(ctx);
    const first = ctx.nodeSessions.startLearning({ nodeId: node.node.id, text: "cancel me" });
    await flushUntil(() => adapter.requests.length === 1);
    const second = ctx.nodeSessions.sendMessage({ nodeId: node.node.id, text: "keep me" });

    expect(ctx.nodeSessions.stop(node.node.id)).toBe(true);
    await expect(first).resolves.toMatchObject({ turn: { status: "cancelled" } });
    await expect(second).resolves.toMatchObject({ turn: { status: "completed" } });
    expect(ctx.nodeSessions.stop(node.node.id)).toBe(false);
    expect(adapter.requests).toHaveLength(2);
  });

  it("allows another Node to run while one Node is blocked", async () => {
    const { ctx, adapter } = await createKit([{ kind: "hang" }, textResponse("B done")]);
    const a = createNode(ctx, "A");
    const b = createNode(ctx, "B");
    const blocked = ctx.nodeSessions.startLearning({ nodeId: a.node.id, text: "block A" });
    await flushUntil(() => adapter.requests.length === 1);

    await expect(ctx.nodeSessions.startLearning({ nodeId: b.node.id, text: "run B" }))
      .resolves.toMatchObject({ turn: { status: "completed" } });
    expect(ctx.nodeSessions.stop(a.node.id)).toBe(true);
    await expect(blocked).resolves.toMatchObject({ turn: { status: "cancelled" } });
  });

  it("returns Runtime failures with a closed Turn log", async () => {
    const { ctx } = await createKit([{
      kind: "chunks",
      chunks: [{ type: "finish", reason: { kind: "error", failure: { code: "MODEL", message: "failed" } } }],
    }]);
    const node = createNode(ctx);

    const result = await ctx.nodeSessions.startLearning({ nodeId: node.node.id, text: "fail" });

    expect(result.turn).toMatchObject({ status: "failed", failure: { code: "MODEL" } });
    const types = ctx.sessions.getEvents(result.sessionId).map((event) => event.type);
    expect(types[0]).toBe("turn-started");
    expect(types.at(-1)).toBe("turn-ended");
    expect(types.filter((type) => type === "step-started")).toHaveLength(1);
    expect(types.filter((type) => type === "step-ended")).toHaveLength(1);
  });

  it("cancels active work and rejects queued work when unloaded", async () => {
    const { ctx, adapter, serviceFiber } = await createKit([{ kind: "hang" }]);
    const node = createNode(ctx);
    const active = ctx.nodeSessions.startLearning({ nodeId: node.node.id, text: "active" });
    await flushUntil(() => adapter.requests.length === 1);
    const queued = ctx.nodeSessions.sendMessage({ nodeId: node.node.id, text: "queued" });

    await serviceFiber.dispose();

    await expect(active).resolves.toMatchObject({ turn: { status: "cancelled" } });
    await expect(queued).rejects.toMatchObject({ code: "node-session-service-unavailable" });
    expect(adapter.requests).toHaveLength(1);
    expect(Reflect.get(ctx, "nodeSessions")).toBeUndefined();
  });
});

async function* chunks(text: string) {
  yield { type: "block-end" as const, index: 0, block: { type: "text" as const, text } };
  yield { type: "finish" as const, reason: { kind: "stop" as const } };
}
