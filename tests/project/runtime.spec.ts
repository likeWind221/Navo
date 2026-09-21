import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../../src/agent/runtime.js";
import type { NodeId, ProjectId } from "../../src/brand/ids.js";
import { LLMService } from "../../src/llm/service.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";
import { MailboxStore } from "../../src/mailbox/store.js";
import { NodeSessionService } from "../../src/node/session.js";
import { NodeStore } from "../../src/node/store.js";
import { ProjectRuntime } from "../../src/project/runtime.js";
import { ProjectStore } from "../../src/project/store.js";
import { ResourceService } from "../../src/resource/service.js";
import { RoadmapStore } from "../../src/roadmap/store.js";
import { SessionStore } from "../../src/session/store.js";
import { MockFetchCore } from "../../src/tools/builtins/fetch/mock.js";
import { FetchTool } from "../../src/tools/builtins/fetch/tool.js";
import { SendToMainTool } from "../../src/tools/builtins/mailbox/send.js";
import { ResourceToolsPlugin } from "../../src/tools/builtins/resource/plugin.js";
import { MockSearchAdapter } from "../../src/tools/builtins/search/adapters/mock.js";
import { SearchTool } from "../../src/tools/builtins/search/tool.js";
import { ToolService } from "../../src/tools/service.js";
import { ProjectWorkspaceStore } from "../../src/workspace/store.js";
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
  await ctx.plugin(SendToMainTool);
  await ctx.plugin(SearchTool, { adapter: new MockSearchAdapter([]) });
  await ctx.plugin(FetchTool, { core: new MockFetchCore([]) });

  const adapter = new MockLLMAdapter(entries);
  ctx.llm.registerAdapter("mock", adapter);

  await ctx.plugin(NodeSessionService, {
    model: { provider: "mock", model: "project-runtime-test" },
  });
  await ctx.plugin(RoadmapStore);
  await ctx.plugin(ProjectRuntime);

  return { ctx, adapter };
}

function createWorkNode(ctx: Context, projectId: ProjectId, title: string) {
  return ctx.nodes.create({
    projectId,
    objective: {
      title,
      description: `Execute ${title}`,
      acceptanceCriteria: [`${title} complete`],
    },
  });
}

function addRoadmap(ctx: Context, projectId: ProjectId, nodeIds: readonly NodeId[]) {
  ctx.roadmaps.create({
    definition: {
      projectId,
      nodes: [...nodeIds],
      edges: [],
    },
    reason: "Human-approved plan",
  });
}

async function flushUntil(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 30 && !condition(); index += 1) {
    await Promise.resolve();
  }
  if (!condition()) throw new Error("expected asynchronous boundary was not reached");
}

describe("ProjectRuntime Human-controlled Node start", () => {
  it("starts an idle Roadmap Node only after an explicit Human call", async () => {
    const { ctx, adapter } = await createKit([
      modelResponse([{ type: "text", text: "done" }]),
    ]);
    const project = ctx.projects.create({ goal: "Ship the Project" });
    const node = createWorkNode(ctx, project.id, "Implement");
    addRoadmap(ctx, project.id, [node.node.id]);

    expect(ctx.nodes.get(node.node.id)?.status).toBe("idle");
    expect(ctx.projectRuntime.canStartNode(project.id, node.node.id)).toBe(true);
    expect(adapter.requests).toHaveLength(0);

    await expect(ctx.projectRuntime.startNode({
      projectId: project.id,
      nodeId: node.node.id,
      text: "Start this Node",
    })).resolves.toMatchObject({
      nodeId: node.node.id,
      turn: { status: "completed" },
    });

    expect(adapter.requests).toHaveLength(1);
    expect(ctx.nodes.get(node.node.id)?.status).toBe("idle");
    expect(ctx.projectRuntime.canStartNode(project.id, node.node.id)).toBe(true);
  });

  it("does not treat an idle Node outside the current Roadmap as executable", async () => {
    const { ctx, adapter } = await createKit([]);
    const project = ctx.projects.create({ goal: "Follow the current plan" });
    const detached = createWorkNode(ctx, project.id, "Detached");
    ctx.nodes.unlock(detached.node.id, "Independent before Roadmap");
    const planned = createWorkNode(ctx, project.id, "Planned");
    addRoadmap(ctx, project.id, [planned.node.id]);

    expect(ctx.nodes.get(detached.node.id)?.status).toBe("idle");
    expect(ctx.projectRuntime.canStartNode(project.id, detached.node.id)).toBe(false);
    expect(() => ctx.projectRuntime.startNode({
      projectId: project.id,
      nodeId: detached.node.id,
      text: "Run detached",
    })).toThrow(expect.objectContaining({
      code: "invalid-state",
      message: "Node is not part of the current Project Roadmap.",
    }));
    expect(adapter.requests).toHaveLength(0);
  });

  it("keeps legacy independent Nodes executable when the Project has no Roadmap", async () => {
    const { ctx } = await createKit([
      modelResponse([{ type: "text", text: "done" }]),
    ]);
    const project = ctx.projects.create({ goal: "Standalone work" });
    const node = createWorkNode(ctx, project.id, "Standalone");
    ctx.nodes.unlock(node.node.id, "Human selected standalone work");

    expect(ctx.projectRuntime.canStartNode(project.id, node.node.id)).toBe(true);
    await expect(ctx.projectRuntime.startNode({
      projectId: project.id,
      nodeId: node.node.id,
      text: "Run standalone",
    })).resolves.toMatchObject({ turn: { status: "completed" } });
  });

  it("rejects archived Projects, cross-Project Nodes, locked Nodes, and control Nodes", async () => {
    const { ctx, adapter } = await createKit([]);
    const first = ctx.projects.create({ goal: "First" });
    const second = ctx.projects.create({ goal: "Second" });
    const locked = createWorkNode(ctx, first.id, "Locked");
    const foreign = createWorkNode(ctx, second.id, "Foreign");
    const control = ctx.nodes.create({
      projectId: first.id,
      kind: "control",
      purpose: "start",
      title: "Start",
    });
    ctx.nodes.unlock(control.node.id, "Ready");

    expect(ctx.projectRuntime.canStartNode(first.id, locked.node.id)).toBe(false);
    expect(() => ctx.projectRuntime.startNode({
      projectId: first.id,
      nodeId: foreign.node.id,
      text: "Cross project",
    })).toThrow(expect.objectContaining({ code: "node-not-found" }));
    expect(() => ctx.projectRuntime.startNode({
      projectId: first.id,
      nodeId: control.node.id,
      text: "Run control",
    })).toThrow(expect.objectContaining({ code: "invalid-state" }));

    ctx.projects.archive(first.id, "Pause");
    expect(ctx.projectRuntime.canStartNode(first.id, control.node.id)).toBe(false);
    expect(() => ctx.projectRuntime.startNode({
      projectId: first.id,
      nodeId: locked.node.id,
      text: "Run archived",
    })).toThrow(expect.objectContaining({ code: "project-unavailable" }));
    expect(adapter.requests).toHaveLength(0);
  });

  it("rejects a second Human start before the first Turn can be queued implicitly", async () => {
    const { ctx, adapter } = await createKit([{ kind: "hang" }]);
    const project = ctx.projects.create({ goal: "No duplicate starts" });
    const node = createWorkNode(ctx, project.id, "Long work");
    addRoadmap(ctx, project.id, [node.node.id]);

    const first = ctx.projectRuntime.startNode({
      projectId: project.id,
      nodeId: node.node.id,
      text: "First Human start",
    });

    expect(ctx.projectRuntime.canStartNode(project.id, node.node.id)).toBe(false);
    expect(() => ctx.projectRuntime.startNode({
      projectId: project.id,
      nodeId: node.node.id,
      text: "Second Human start",
    })).toThrow(expect.objectContaining({
      code: "invalid-state",
      message: "Node already has a Human-started Turn in progress.",
    }));

    await flushUntil(() => adapter.requests.length === 1);
    expect(ctx.nodes.get(node.node.id)?.status).toBe("working");
    expect(ctx.nodeSessions.stop(node.node.id)).toBe(true);
    await expect(first).resolves.toMatchObject({ turn: { status: "cancelled" } });
    expect(ctx.nodes.get(node.node.id)?.status).toBe("idle");
  });
});
