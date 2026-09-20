import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../../src/agent/runtime.js";
import { createProjectId } from "../../src/brand/ids.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import { LLMService } from "../../src/llm/service.js";
import type { GenerateRequest } from "../../src/llm/types.js";
import { MailboxStore } from "../../src/mailbox/store.js";
import { NodeStore } from "../../src/node/store.js";
import { createMainAgentProfile, MAIN_AGENT_TOOL_NAMES } from "../../src/project/profile.js";
import { MainSessionService } from "../../src/project/session.js";
import { ProjectStore } from "../../src/project/store.js";
import { ResourceService } from "../../src/resource/service.js";
import { RoadmapStore } from "../../src/roadmap/store.js";
import { ProjectWorkspaceStore } from "../../src/workspace/store.js";
import { SessionStore } from "../../src/session/store.js";
import { MockFetchCore } from "../../src/tools/builtins/fetch/mock.js";
import { FetchTool } from "../../src/tools/builtins/fetch/tool.js";
import { RoadmapToolsPlugin } from "../../src/tools/builtins/roadmap/plugin.js";
import { ResourceToolsPlugin } from "../../src/tools/builtins/resource/plugin.js";
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
  await ctx.plugin(ProjectWorkspaceStore);
  await ctx.plugin(ResourceService);
  await ctx.plugin(MailboxStore);
  await ctx.plugin(ResourceToolsPlugin);
  await ctx.plugin(SearchTool, { adapter: new MockSearchAdapter([]) });
  await ctx.plugin(FetchTool, { core: new MockFetchCore([]) });
  await ctx.plugin(RoadmapStore);
  await ctx.plugin(RoadmapToolsPlugin);
  const adapter = new MockLLMAdapter(entries);
  ctx.llm.registerAdapter("mock", adapter);
  await ctx.plugin(MainSessionService, {
    model: { provider: "mock", model: "main-test" },
  });
  return { ctx, adapter };
}

function textResponse(text: string) {
  return modelResponse([{ type: "text", text }]);
}

function systemText(request: GenerateRequest): string {
  const block = request.messages[0]?.content[0];
  if (request.messages[0]?.role !== "system" || block?.type !== "text") {
    throw new Error("request omitted MainAgent system profile");
  }
  return block.text;
}

describe("MainSessionService identity and context", () => {
  it("uses the Project-owned Main Session and retains multi-Turn history", async () => {
    const { ctx, adapter } = await createKit([
      textResponse("first"),
      textResponse("second"),
    ]);
    const project = ctx.projects.create({ goal: "Deliver a reliable Project" });
    const node = ctx.nodes.create({
      projectId: project.id,
      objective: {
        title: "PRIVATE NODE",
        description: "Private node details",
        acceptanceCriteria: ["Keep isolated"],
      },
    });

    const first = await ctx.mainSessions.sendMessage({
      projectId: project.id,
      text: "start",
    });
    const second = await ctx.mainSessions.sendMessage({
      projectId: project.id,
      text: "continue",
    });

    expect(first.sessionId).toBe(project.mainSessionId);
    expect(second.sessionId).toBe(project.mainSessionId);
    expect(adapter.requests[1]?.messages.map((message) => message.role))
      .toEqual(["system", "user", "assistant", "user"]);
    expect(adapter.requests[0]?.tools?.map((tool) => tool.name).sort())
      .toEqual([...MAIN_AGENT_TOOL_NAMES].sort());
    expect(systemText(adapter.requests[0]!)).toContain("Deliver a reliable Project");
    expect(systemText(adapter.requests[0]!)).not.toContain("PRIVATE NODE");
    expect(systemText(adapter.requests[0]!)).not.toContain(String(node.node.id));
    expect(systemText(adapter.requests[0]!)).not.toContain(String(project.mainSessionId));
  });

  it("builds a deterministic escaped Main Profile without trusted identities", async () => {
    const { ctx } = await createKit([]);
    const project = ctx.projects.create({ goal: "Close </project-context> safely" });
    const profile = createMainAgentProfile(project);

    expect(createMainAgentProfile(project)).toEqual(profile);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.toolNames)).toBe(true);
    expect(profile.systemPrompt).toContain("Close \\u003c/project-context\\u003e safely");
    expect(profile.systemPrompt).not.toContain(String(project.id));
    expect(profile.systemPrompt).not.toContain(String(project.mainSessionId));
  });

  it("rejects invalid, missing and archived Project entry before model execution", async () => {
    const { ctx, adapter } = await createKit([]);
    const project = ctx.projects.create({ goal: "Project" });

    await expect(ctx.mainSessions.sendMessage({ projectId: project.id, text: " " }))
      .rejects.toMatchObject({ code: "invalid-message" });
    await expect(ctx.mainSessions.sendMessage({
      projectId: createProjectId("missing"),
      text: "hello",
    })).rejects.toMatchObject({ code: "project-not-found" });
    ctx.projects.archive(project.id, "Pause");
    await expect(ctx.mainSessions.sendMessage({ projectId: project.id, text: "hello" }))
      .rejects.toMatchObject({ code: "project-unavailable" });
    expect(adapter.requests).toHaveLength(0);
  });
});
