import { Context } from "cordis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentRuntime } from "../../src/agent/runtime.js";
import type { SessionAgentContext } from "../../src/agent/types.js";
import { createMessageId, createSessionId, createStepId, createTurnId } from "../../src/brand/ids.js";
import type { SessionId } from "../../src/brand/ids.js";
import { CompactCommand } from "../../src/command/compact.js";
import { SessionContextResolver } from "../../src/command/context.js";
import { CommandService } from "../../src/command/service.js";
import { createSessionCommandHandler } from "../../src/host/command.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import { LLMService } from "../../src/llm/service.js";
import { MailboxStore } from "../../src/mailbox/store.js";
import { NODE_AGENT_TOOL_NAMES } from "../../src/node/profile.js";
import { NodeSessionService } from "../../src/node/session.js";
import { NodeStore } from "../../src/node/store.js";
import { createMainAgentProfile, MAIN_AGENT_TOOL_NAMES } from "../../src/project/profile.js";
import { MainSessionService } from "../../src/project/session.js";
import { ProjectStore } from "../../src/project/store.js";
import { ResourceService } from "../../src/resource/service.js";
import { SessionStore } from "../../src/session/store.js";
import type { CommandEvent } from "../../shared/content.js";
import { ToolService } from "../../src/tools/service.js";
import { ProjectWorkspaceStore } from "../../src/workspace/store.js";
import { modelError, modelResponse } from "../helpers/runtime.js";
import { memoryStorage } from "../helpers/storage.js";

const contexts = new Set<Context>();

afterEach(async () => {
  await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
  contexts.clear();
});

const compactingModel = Object.freeze({
  provider: "mock",
  model: "test",
  contextWindow: 20_000,
  maxTokens: 500,
});

interface Kit {
  readonly ctx: Context;
  readonly adapter: MockLLMAdapter;
}

async function createKit(
  entries: ConstructorParameters<typeof MockLLMAdapter>[0],
  agent: SessionAgentContext | null = {
    model: compactingModel,
    systemPrompt: "",
    toolNames: [],
  },
): Promise<Kit> {
  const ctx = new Context();
  contexts.add(ctx);
  await ctx.plugin(SessionStore);
  await ctx.plugin(LLMService);
  await ctx.plugin(ToolService);
  await ctx.plugin(AgentRuntime);
  await memoryStorage(ctx);
  await ctx.plugin(ProjectStore);
  await ctx.plugin(NodeStore);
  await ctx.plugin(ProjectWorkspaceStore);
  await ctx.plugin(ResourceService);
  await ctx.plugin(MailboxStore);
  await ctx.plugin(CommandService);
  await ctx.plugin(MainSessionService, { model: compactingModel });
  await ctx.plugin(NodeSessionService, { model: compactingModel });
  await ctx.plugin(SessionContextResolver, agent === null ? {} : { agent: { ...agent } });
  await ctx.plugin(CompactCommand);
  const adapter = new MockLLMAdapter(entries);
  ctx.llm.registerAdapter("mock", adapter);
  return { ctx, adapter };
}

function seedHistory(
  ctx: Context,
  sessionId: SessionId,
  count: number,
  characters: number,
): void {
  for (let index = 0; index < count; index += 1) {
    ctx.sessions.append({
      type: "user-message",
      sessionId,
      data: { message: {
        id: createMessageId(`seed-user-${index}`),
        role: "user",
        content: [{ type: "text", text: "u".repeat(characters) }],
      } },
    });
    if (index === count - 1) continue;
    ctx.sessions.append({
      type: "assistant-message",
      sessionId,
      data: {
        turnId: createTurnId("seed-turn"),
        stepId: createStepId("seed-step"),
        message: {
          id: createMessageId(`seed-assistant-${index}`),
          role: "assistant",
          content: [{ type: "text", text: "a".repeat(characters) }],
        },
        finishReason: { kind: "stop" },
      },
    });
  }
}

async function executeCompact(
  kit: Kit,
  sessionId: SessionId,
  options: { readonly args?: string; readonly signal?: AbortSignal } = {},
): Promise<CommandEvent[]> {
  const events: CommandEvent[] = [];
  await kit.ctx.commands.execute({
    sessionId,
    commandId: `compact-${sessionId}`,
    name: "compact",
    args: options.args ?? "",
  }, event => { events.push(event); }, options.signal ?? new AbortController().signal);
  return events;
}

function summaryResponse(text = "## Goal and User Constraints\n- Keep the task.") {
  return modelResponse([{ type: "text", text }]);
}

function systemText(request: { messages: readonly { role: string; content: readonly { type: string; text?: string }[] }[] }): string {
  const message = request.messages[0];
  const block = message?.content[0];
  if (message?.role !== "system" || block?.type !== "text" || block.text === undefined) {
    throw new Error("request omitted its system profile");
  }
  return block.text;
}

function registerToolStubs(ctx: Context, names: readonly string[]): void {
  for (const name of names) {
    ctx.tools.register({
      name,
      description: `Stub for ${name}.`,
      parameters: { type: "object", properties: {}, additionalProperties: false },
      execute: async () => ({ content: "" }),
    });
  }
}

function compactionEvents(kit: Kit, sessionId: SessionId) {
  return kit.ctx.sessions.getEvents(sessionId).filter(event =>
    event.type === "compaction-started"
    || event.type === "compaction-checkpoint"
    || event.type === "compaction-ended");
}

describe("manual compaction command", () => {
  it("compacts below the pressure threshold and the next Turn reads the checkpoint", async () => {
    const kit = await createKit([
      summaryResponse(),
      modelResponse([{ type: "text", text: "continued after manual compaction" }]),
    ]);
    const sessionId = createSessionId("manual-success");
    seedHistory(kit.ctx, sessionId, 6, 1_200);
    const lastSequence = kit.ctx.sessions.getSurfaceSnapshot(sessionId).sequences.at(-1)!;

    const result = await executeCompact(kit, sessionId);

    expect(result.map(event => event.type)).toEqual(["command-started", "command-completed"]);
    expect(result[1]).toMatchObject({ type: "command-completed", summary: expect.stringContaining("Compacted context") });
    expect(result[1]?.type === "command-completed" ? result[1].summary : "")
      .toContain("mock/test");

    const events = compactionEvents(kit, sessionId);
    expect(events.map(event => event.type)).toEqual([
      "compaction-started",
      "compaction-checkpoint",
      "compaction-ended",
    ]);
    for (const event of events) expect(event.data).not.toHaveProperty("turnId");
    expect(events[0]).toMatchObject({ data: { trigger: "manual" } });
    expect(events[0]?.type === "compaction-started" ? events[0].data.coveredEnd : 0)
      .toBeLessThan(lastSequence);
    expect(events[2]).toMatchObject({ data: { status: "completed" } });
    expect(kit.ctx.sessions.getEvents(sessionId).some(event =>
      event.type === "turn-started" || event.type === "turn-ended")).toBe(false);

    const checkpoint = kit.ctx.sessions.deriveMessages(sessionId)
      .find(message => message.content.some(block => block.type === "text" && block.text.includes("<compacted-summary>")));
    expect(checkpoint).toBeDefined();

    const context = kit.ctx.sessionContexts.resolve(sessionId);
    const turn = await kit.ctx.agentRuntime.runTurn({
      sessionId,
      userMessage: {
        id: createMessageId("manual-next-user"),
        role: "user",
        content: [{ type: "text", text: "continue" }],
      },
      model: context.model,
      systemPrompt: context.systemPrompt,
      toolNames: context.toolNames,
    });
    expect(turn.status).toBe("completed");
    const turnRequest = kit.adapter.requests.at(-1)!;
    expect(turnRequest.messages.some(message => message.content.some(
      block => block.type === "text" && block.text.includes("<compacted-summary>"),
    ))).toBe(true);
    expect(turnRequest.messages.some(message => message.id === createMessageId("seed-user-0"))).toBe(false);
  });

  it("reports no progress without touching history when there is no safe selection", async () => {
    const kit = await createKit([]);
    const sessionId = createSessionId("manual-short-history");
    for (const [index, text] of ["one", "two", "three"].entries()) {
      kit.ctx.sessions.append({
        type: "user-message",
        sessionId,
        data: { message: { id: createMessageId(`short-user-${index}`), role: "user",
          content: [{ type: "text", text }] } },
      });
    }
    const before = kit.ctx.sessions.getEvents(sessionId);

    const result = await executeCompact(kit, sessionId);

    expect(result[1]).toMatchObject({
      type: "command-completed",
      summary: expect.stringContaining("No compaction performed"),
    });
    expect(kit.ctx.sessions.getEvents(sessionId)).toEqual(before);
    expect(kit.adapter.requests).toHaveLength(0);
  });

  it("reports unavailable model capacity without guessing a window", async () => {
    const kit = await createKit([], {
      model: { provider: "mock", model: "test" },
      systemPrompt: "",
      toolNames: [],
    });
    const sessionId = createSessionId("manual-no-capacity");
    seedHistory(kit.ctx, sessionId, 6, 1_200);
    const before = kit.ctx.sessions.getEvents(sessionId);

    const result = await executeCompact(kit, sessionId);

    expect(result[1]).toMatchObject({
      type: "command-completed",
      summary: expect.stringContaining("No compaction performed"),
    });
    expect(result[1]?.type === "command-completed" ? result[1].summary : "")
      .toContain("no context capacity or auto-compact limit");
    expect(kit.ctx.sessions.getEvents(sessionId)).toEqual(before);
    expect(kit.adapter.requests).toHaveLength(0);
  });

  it("keeps history when the summary does not shrink the selected prefix", async () => {
    const kit = await createKit([summaryResponse("s".repeat(20_000))]);
    const sessionId = createSessionId("manual-no-shrink");
    seedHistory(kit.ctx, sessionId, 6, 1_200);
    const before = kit.ctx.sessions.deriveMessages(sessionId);

    const result = await executeCompact(kit, sessionId);

    expect(result[1]).toMatchObject({
      type: "command-completed",
      summary: expect.stringContaining("No compaction performed"),
    });
    expect(kit.ctx.sessions.deriveMessages(sessionId)).toEqual(before);
    const events = compactionEvents(kit, sessionId);
    expect(events.map(event => event.type)).toEqual(["compaction-started", "compaction-ended"]);
    expect(events[1]).toMatchObject({ data: { status: "failed" } });
  });

  it("fails the command when summary generation fails", async () => {
    const kit = await createKit([modelError("INVALID_REQUEST")]);
    const sessionId = createSessionId("manual-summary-failure");
    seedHistory(kit.ctx, sessionId, 6, 1_200);
    const before = kit.ctx.sessions.deriveMessages(sessionId);

    const result = await executeCompact(kit, sessionId);

    expect(result.map(event => event.type)).toEqual(["command-started", "command-failed"]);
    expect(result[1]).toMatchObject({ type: "command-failed", failure: { code: "command-failed" } });
    expect(kit.ctx.sessions.deriveMessages(sessionId)).toEqual(before);
    expect(compactionEvents(kit, sessionId).map(event => event.type))
      .toEqual(["compaction-started", "compaction-ended"]);
  });

  it("propagates cancellation and records a cancelled transaction", async () => {
    const kit = await createKit([{ kind: "hang" }]);
    const sessionId = createSessionId("manual-cancel");
    seedHistory(kit.ctx, sessionId, 6, 1_200);
    const before = kit.ctx.sessions.deriveMessages(sessionId);
    const controller = new AbortController();
    const running = executeCompact(kit, sessionId, { signal: controller.signal });
    await vi.waitFor(() => expect(kit.adapter.requests).toHaveLength(1));

    controller.abort();
    const result = await running;

    expect(result.map(event => event.type)).toEqual(["command-started", "command-cancelled"]);
    expect(kit.ctx.sessions.deriveMessages(sessionId)).toEqual(before);
    const events = compactionEvents(kit, sessionId);
    expect(events.map(event => event.type)).toEqual(["compaction-started", "compaction-ended"]);
    expect(events[1]).toMatchObject({ data: { status: "cancelled" } });
  });

  it("waits for an active Turn before modifying history", async () => {
    const kit = await createKit([
      { kind: "hang" },
      summaryResponse(),
    ]);
    const sessionId = createSessionId("manual-queued");
    seedHistory(kit.ctx, sessionId, 6, 1_200);
    const controller = new AbortController();
    const started = Promise.withResolvers<void>();
    const turn = kit.ctx.agentRuntime.runTurn({
      sessionId,
      userMessage: {
        id: createMessageId("queued-turn-user"),
        role: "user",
        content: [{ type: "text", text: "active turn" }],
      },
      model: { provider: "mock", model: "test" },
      signal: controller.signal,
      onEvent(event) {
        if (event.type === "turn-started") started.resolve();
      },
    });
    await started.promise;
    await vi.waitFor(() => expect(kit.adapter.requests).toHaveLength(1));

    const command = executeCompact(kit, sessionId);
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(compactionEvents(kit, sessionId)).toHaveLength(0);

    controller.abort();
    await turn;
    await command;

    const events = kit.ctx.sessions.getEvents(sessionId).map(event => event.type);
    expect(events.indexOf("turn-ended")).toBeGreaterThanOrEqual(0);
    expect(events.indexOf("compaction-started")).toBeGreaterThan(events.indexOf("turn-ended"));
  });

  it("rejects arguments", async () => {
    const kit = await createKit([]);
    const sessionId = createSessionId("manual-args");
    const result = await executeCompact(kit, sessionId, { args: "now" });
    expect(result[0]).toMatchObject({ type: "command-failed", failure: { code: "invalid-args" } });
  });

  it("fails closed for an unbound Session without a configured agent context", async () => {
    const kit = await createKit([], null);
    const sessionId = createSessionId("manual-unbound");
    seedHistory(kit.ctx, sessionId, 6, 1_200);

    const result = await executeCompact(kit, sessionId);

    expect(result.map(event => event.type)).toEqual(["command-started", "command-failed"]);
    expect(result[1]).toMatchObject({ type: "command-failed", failure: { code: "command-failed" } });
    expect(result[1]?.type === "command-failed" ? result[1].failure.message : "")
      .toContain("no resolvable agent context");
  });
});

describe("manual compaction through the session command entry", () => {
  async function runHandler(kit: Kit, sessionId: SessionId): Promise<CommandEvent[]> {
    const events: CommandEvent[] = [];
    for await (const event of createSessionCommandHandler(kit.ctx)({
      sessionId: String(sessionId),
      commandId: `entry-${sessionId}`,
      name: "compact",
      args: "",
    }, new AbortController().signal)) events.push(event);
    return events;
  }

  it("completes a compact request and reports a no-op path", async () => {
    const kit = await createKit([summaryResponse()]);
    const successId = createSessionId("entry-success");
    seedHistory(kit.ctx, successId, 6, 1_200);
    const success = await runHandler(kit, successId);
    expect(success.map(event => event.type)).toEqual(["command-started", "command-completed"]);
    expect(success[1]?.type === "command-completed" ? success[1].summary : "")
      .toContain("Compacted context");

    const noopId = createSessionId("entry-noop");
    const noop = await runHandler(kit, noopId);
    expect(noop.map(event => event.type)).toEqual(["command-started", "command-completed"]);
    expect(noop[1]?.type === "command-completed" ? noop[1].summary : "")
      .toContain("No compaction performed");
  });
});

describe("manual compaction context resolution", () => {
  it("uses the current Main profile and does not start Turn or Node work", async () => {
    const kit = await createKit([summaryResponse()]);
    registerToolStubs(kit.ctx, MAIN_AGENT_TOOL_NAMES);
    const project = kit.ctx.projects.create({ name: "Project", goal: "Keep the authoritative goal" });
    seedHistory(kit.ctx, project.mainSessionId, 6, 1_200);

    const result = await executeCompact(kit, project.mainSessionId);

    expect(result.map(event => event.type)).toEqual(["command-started", "command-completed"]);
    const profile = createMainAgentProfile(kit.ctx.projects.get(project.id)!, false);
    expect(systemText(kit.adapter.requests[0]!)).toBe(profile.systemPrompt);
    const events = kit.ctx.sessions.getEvents(project.mainSessionId).map(event => event.type);
    expect(events).not.toContain("turn-started");
    expect(events).not.toContain("turn-ended");
    expect(events).toContain("compaction-checkpoint");
  });

  it("uses the current Node profile without starting Node work", async () => {
    const kit = await createKit([summaryResponse()]);
    registerToolStubs(kit.ctx, NODE_AGENT_TOOL_NAMES);
    const project = kit.ctx.projects.create({ name: "Project", goal: "Deliver the Node objective" });
    const created = kit.ctx.nodes.create({
      projectId: project.id,
      objective: {
        title: "Compact safely",
        description: "Compress context without changing Node state",
        acceptanceCriteria: ["History is reduced"],
      },
    });
    kit.ctx.nodes.unlock(created.node.id, "Ready");
    const sessionId = createSessionId("manual-node");
    kit.ctx.nodes.bindSession(created.node.id, sessionId);
    seedHistory(kit.ctx, sessionId, 6, 1_200);
    const nodeEvents = kit.ctx.nodes.getEvents(created.node.id).length;
    const status = kit.ctx.nodes.get(created.node.id)!.status;

    const result = await executeCompact(kit, sessionId);

    expect(result.map(event => event.type)).toEqual(["command-started", "command-completed"]);
    const prompt = systemText(kit.adapter.requests[0]!);
    expect(prompt).toContain("Navo's Node Agent");
    expect(prompt).toContain("Compact safely");
    expect(kit.ctx.nodes.get(created.node.id)!.status).toBe(status);
    expect(kit.ctx.nodes.getEvents(created.node.id)).toHaveLength(nodeEvents);
    expect(kit.ctx.sessions.getEvents(sessionId).map(event => event.type))
      .not.toContain("turn-started");
  });
});
