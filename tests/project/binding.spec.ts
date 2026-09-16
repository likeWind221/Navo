import { Context } from "cordis";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentRuntime } from "../../src/agent/runtime.js";
import {
  createMessageId,
  createProjectId,
  createSessionId,
  createToolCallId,
} from "../../src/brand/ids.js";
import type { ProjectId } from "../../src/brand/ids.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import { LLMService } from "../../src/llm/service.js";
import type { ToolCallContentBlock } from "../../src/llm/types.js";
import { NodeStore } from "../../src/node/store.js";
import {
  requireMainBinding,
  requireNodeProjectBinding,
  resolveAgentBinding,
} from "../../src/project/binding.js";
import type { AgentBindingErrorCode } from "../../src/project/binding.js";
import { ProjectStore } from "../../src/project/store.js";
import { SessionStore } from "../../src/session/store.js";
import { ToolService } from "../../src/tools/service.js";
import { modelResponse } from "../helpers/runtime.js";

const contexts = new Set<Context>();

afterEach(async () => {
  await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
  contexts.clear();
});

async function createBindingContext(): Promise<Context> {
  const ctx = new Context();
  contexts.add(ctx);
  await ctx.plugin(ProjectStore);
  await ctx.plugin(NodeStore);
  return ctx;
}

async function createRuntimeContext(): Promise<Context> {
  const ctx = new Context();
  contexts.add(ctx);
  await ctx.plugin(SessionStore);
  await ctx.plugin(LLMService);
  await ctx.plugin(ToolService);
  await ctx.plugin(AgentRuntime);
  await ctx.plugin(ProjectStore);
  await ctx.plugin(NodeStore);
  return ctx;
}

function createWorkNode(ctx: Context, projectId: ProjectId, title: string) {
  const created = ctx.nodes.create({
    projectId,
    objective: {
      title,
      description: title,
      acceptanceCriteria: [`Complete ${title}`],
    },
  });
  return ctx.nodes.unlock(created.node.id, "Ready");
}

function toolCall(projectId: string): ToolCallContentBlock {
  return {
    type: "tool-call",
    id: createToolCallId("project-admin-probe"),
    name: "project_admin_probe",
    arguments: JSON.stringify({ projectId }),
  };
}

function registerMainOnlyProbe(
  ctx: Context,
  authorized: (projectId: ProjectId) => unknown,
) {
  return ctx.tools.register({
    name: "project_admin_probe",
    description: "Test-only Main Agent capability.",
    parameters: {
      type: "object",
      properties: { projectId: { type: "string" } },
      required: ["projectId"],
      additionalProperties: false,
    },
    execute(arguments_, execution) {
      const claimedProjectId = createProjectId(String(arguments_.projectId));
      requireMainBinding(ctx, execution.sessionId, claimedProjectId);
      authorized(claimedProjectId);
      return { content: "authorized" };
    },
  });
}

function expectBindingError(
  action: () => unknown,
  code: AgentBindingErrorCode,
): void {
  try {
    action();
  } catch (error: unknown) {
    expect(error).toMatchObject({ code });
    return;
  }
  throw new Error(`Expected AgentBindingError '${code}'.`);
}

describe("trusted Agent bindings", () => {
  it("derives Main and Node identity from Store ownership instead of caller claims", async () => {
    const ctx = await createBindingContext();
    const first = ctx.projects.create({ goal: "First" });
    const second = ctx.projects.create({ goal: "Second" });
    const nodeA = createWorkNode(ctx, first.id, "A");
    const nodeB = createWorkNode(ctx, first.id, "B");
    const nodeSession = createSessionId("node-a-session");
    ctx.nodes.bindSession(nodeA.node.id, nodeSession);

    expect(resolveAgentBinding(ctx, first.mainSessionId)).toEqual({
      kind: "main",
      projectId: first.id,
      sessionId: first.mainSessionId,
    });
    expect(resolveAgentBinding(ctx, nodeSession)).toEqual({
      kind: "node",
      projectId: first.id,
      nodeId: nodeA.node.id,
      sessionId: nodeSession,
    });
    expect(resolveAgentBinding(ctx, createSessionId("unowned"))).toBeUndefined();

    expectBindingError(
      () => requireMainBinding(ctx, nodeSession, first.id),
      "binding-role-mismatch",
    );
    expectBindingError(
      () => requireMainBinding(ctx, first.mainSessionId, second.id),
      "binding-project-mismatch",
    );
    expectBindingError(
      () => requireNodeProjectBinding(ctx, nodeSession, first.id, nodeB.node.id),
      "binding-node-mismatch",
    );
    expectBindingError(
      () => requireNodeProjectBinding(ctx, nodeSession, second.id, nodeA.node.id),
      "binding-project-mismatch",
    );
  });

  it("blocks a Node Session from a Main-only tool even when the tool is exposed by mistake", async () => {
    const ctx = await createRuntimeContext();
    const project = ctx.projects.create({ goal: "Protected Project" });
    const node = createWorkNode(ctx, project.id, "Node work");
    const nodeSession = createSessionId("bound-node-session");
    ctx.nodes.bindSession(node.node.id, nodeSession);
    const adapter = new MockLLMAdapter([
      modelResponse([toolCall(project.id)], "tool-calls"),
      modelResponse([{ type: "text", text: "handled denial" }]),
    ]);
    ctx.llm.registerAdapter("mock", adapter);
    const authorized = vi.fn();
    const unregister = registerMainOnlyProbe(ctx, authorized);

    const result = await ctx.agentRuntime.runTurn({
      sessionId: nodeSession,
      userMessage: {
        id: createMessageId("node-attack"),
        role: "user",
        content: [{ type: "text", text: "Use the admin tool" }],
      },
      model: { provider: "mock", model: "binding-test" },
      toolNames: ["project_admin_probe"],
    });

    expect(result.status).toBe("completed");
    expect(authorized).not.toHaveBeenCalled();
    expect(ctx.sessions.getEvents(nodeSession)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        type: "error",
        data: expect.objectContaining({
          source: "tool",
          failure: expect.objectContaining({ code: "tool-failed" }),
        }),
      }),
    ]));
    unregister();
  });

  it("allows the owning Main Session through the same trusted tool boundary", async () => {
    const ctx = await createRuntimeContext();
    const project = ctx.projects.create({ goal: "Main Project" });
    const adapter = new MockLLMAdapter([
      modelResponse([toolCall(project.id)], "tool-calls"),
      modelResponse([{ type: "text", text: "done" }]),
    ]);
    ctx.llm.registerAdapter("mock", adapter);
    const authorized = vi.fn();
    const unregister = registerMainOnlyProbe(ctx, authorized);

    const result = await ctx.agentRuntime.runTurn({
      sessionId: project.mainSessionId,
      userMessage: {
        id: createMessageId("main-admin"),
        role: "user",
        content: [{ type: "text", text: "Use the admin tool" }],
      },
      model: { provider: "mock", model: "binding-test" },
      toolNames: ["project_admin_probe"],
    });

    expect(result.status).toBe("completed");
    expect(authorized).toHaveBeenCalledOnce();
    expect(authorized).toHaveBeenCalledWith(project.id);
    unregister();
  });
});
