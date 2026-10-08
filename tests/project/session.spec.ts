import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../../src/agent/runtime.js";
import { createProjectId } from "../../src/brand/ids.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import { LLMService } from "../../src/llm/service.js";
import type { GenerateRequest } from "../../src/llm/types.js";
import { MailboxStore } from "../../src/mailbox/store.js";
import { ReadMailboxTool } from "../../src/tools/builtins/mailbox/read.js";
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
import { SetProjectGoalTool } from "../../src/tools/builtins/project/goal.js";
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
  await ctx.plugin(ReadMailboxTool);
  await ctx.plugin(SearchTool, { adapter: new MockSearchAdapter([]) });
  await ctx.plugin(FetchTool, { core: new MockFetchCore([]) });
  await ctx.plugin(RoadmapStore);
  await ctx.plugin(RoadmapToolsPlugin);
  await ctx.plugin(SetProjectGoalTool);
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
    const project = ctx.projects.create({ name: "Project", goal: "Deliver a reliable Project" });
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

  it("reminds Main of work Node status changes since its previous Turn", async () => {
    const { ctx, adapter } = await createKit([
      textResponse("first"),
      textResponse("second"),
      textResponse("third"),
    ]);
    const project = ctx.projects.create({ name: "Project", goal: "Track Node changes" });
    const node = ctx.nodes.create({
      projectId: project.id,
      objective: {
        title: "synthesis",
        description: "Combine findings",
        acceptanceCriteria: ["Recommend one option"],
      },
    });
    const lastUserContent = (index: number) => adapter.requests[index]!.messages.at(-1)!.content;

    await ctx.mainSessions.sendMessage({ projectId: project.id, text: "first" });
    expect(lastUserContent(0)).toHaveLength(1);

    ctx.nodes.unlock(node.node.id, "Human confirmed prerequisites");
    await ctx.mainSessions.sendMessage({ projectId: project.id, text: "second" });
    const [human, reminder] = lastUserContent(1);
    expect(human).toEqual({ type: "text", text: "second" });
    const notice = reminder?.type === "text" ? reminder.text : "";
    expect(notice).toContain("<system-reminder>");
    expect(notice).toContain(String(node.node.id));
    expect(notice).toContain("\"previousStatus\": \"locked\"");
    expect(notice).toContain("\"status\": \"idle\"");
    expect(systemText(adapter.requests[1]!)).not.toContain(String(node.node.id));

    await ctx.mainSessions.sendMessage({ projectId: project.id, text: "third" });
    expect(lastUserContent(2)).toHaveLength(1);
  });

  it("builds a deterministic escaped Main Profile without trusted identities", async () => {
    const { ctx } = await createKit([]);
    const project = ctx.projects.create({ name: "Project", goal: "Close </project-context> safely" });
    const profile = createMainAgentProfile(project);

    expect(createMainAgentProfile(project)).toEqual(profile);
    expect(Object.isFrozen(profile)).toBe(true);
    expect(Object.isFrozen(profile.toolNames)).toBe(true);
    expect(profile.systemPrompt).toContain("Close \\u003c/project-context\\u003e safely");
    expect(profile.systemPrompt).not.toContain(String(project.id));
    expect(profile.systemPrompt).not.toContain(String(project.mainSessionId));
    expect(profile.systemPrompt).toContain("may be stale");
    expect(profile.systemPrompt).toContain("Before stating a Node status or whether a Node can run now");
    expect(profile.systemPrompt).toContain("say its current status is unverified");
    expect(profile.systemPrompt).toContain("\"goalStatus\": \"recorded\"");
  });

  it("tells Main that planning waits for an explicitly agreed goal", async () => {
    const { ctx } = await createKit([]);
    const prompt = createMainAgentProfile(ctx.projects.create({ name: "Project", goal: null })).systemPrompt;

    expect(prompt).toContain("\"goal\": null");
    expect(prompt).toContain("\"goalStatus\": \"not yet confirmed\"");
    expect(prompt).toContain("Greetings, small talk and questions never start planning");
    expect(prompt).toContain("A request that itself tells you to plan, create Nodes or persist the plan is not that agreement");
    expect(prompt).toContain("If the request is vague or ambiguous, ask clarifying questions and do not propose a goal yet");
    expect(prompt).toContain("restate the recorded goal and ask whether to start planning with it");
    expect(prompt).toContain("list the differences, propose a revised goal and ask the user to confirm it");
    expect(prompt).toContain("If no goal is recorded and the user describes a task, extract a concise goal");
    expect(prompt).toContain("One explicit user agreement covers both adopting the restated goal and starting planning");
    expect(prompt).toContain("The agreement stays valid for the whole Turn");
    expect(prompt).toContain("set_project_goal fails once a Roadmap exists");
    expect(prompt).toContain("Keep any open questions separate from the proposed goal");
    expect(prompt).toContain("it must not add scope choices, assumptions, defaults or answers to open questions that the user did not explicitly confirm");
    expect(prompt).toContain("leave unanswered questions and your own suggested leanings out of the goal");
    expect(prompt).toContain("After set_project_goal succeeds, tell the user in the same reply what was recorded");
    expect(prompt).toContain("quoting the recorded text verbatim");
    expect(prompt).not.toContain("When read_roadmap reports that no Roadmap exists, use write_roadmap to create the initial plan.");
  });

  it("rejects invalid, missing and archived Project entry before model execution", async () => {
    const { ctx, adapter } = await createKit([]);
    const project = ctx.projects.create({ name: "Project", goal: "Project" });

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
