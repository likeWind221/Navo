import { Context } from "cordis";
import { afterEach } from "vitest";

import { AgentRuntime } from "../../../src/agent/runtime.js";
import type { NodeId, ProjectId } from "../../../src/brand/ids.js";
import { LLMService } from "../../../src/llm/service.js";
import { MockLLMAdapter } from "../../../src/llm/adapters/mock.js";
import { MailboxStore } from "../../../src/mailbox/store.js";
import { NodeSessionService } from "../../../src/node/session.js";
import { NodeStore } from "../../../src/node/store.js";
import { ProjectRuntime } from "../../../src/project/runtime.js";
import { ProjectStore } from "../../../src/project/store.js";
import { ResourceService } from "../../../src/resource/service.js";
import { RoadmapStore } from "../../../src/roadmap/store.js";
import { SessionStore } from "../../../src/session/store.js";
import { MockFetchCore } from "../../../src/tools/builtins/fetch/mock.js";
import { FetchTool } from "../../../src/tools/builtins/fetch/tool.js";
import { SendToMainTool } from "../../../src/tools/builtins/mailbox/send.js";
import { ResourceToolsPlugin } from "../../../src/tools/builtins/resource/plugin.js";
import { MockSearchAdapter } from "../../../src/tools/builtins/search/adapters/mock.js";
import { SearchTool } from "../../../src/tools/builtins/search/tool.js";
import { ToolService } from "../../../src/tools/service.js";
import { ProjectWorkspaceStore } from "../../../src/workspace/store.js";

import { MainSessionService } from "../../../src/project/session.js";
import { ReadMailboxTool } from "../../../src/tools/builtins/mailbox/read.js";
import { RoadmapToolsPlugin } from "../../../src/tools/builtins/roadmap/plugin.js";

const contexts = new Set<Context>();

afterEach(async () => {
  await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
  contexts.clear();
});

export async function createKit(
  entries: ConstructorParameters<typeof MockLLMAdapter>[0],
  searchEntries: ConstructorParameters<typeof MockSearchAdapter>[0] = [],
) {
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
  const searchAdapter = new MockSearchAdapter(searchEntries);
  await ctx.plugin(SearchTool, { adapter: searchAdapter });
  await ctx.plugin(FetchTool, { core: new MockFetchCore([]) });

  const adapter = new MockLLMAdapter(entries);
  ctx.llm.registerAdapter("mock", adapter);

  const nodeFiber = ctx.plugin(NodeSessionService, {
    model: { provider: "mock", model: "project-runtime-test" },
  });
  await nodeFiber;
  await ctx.plugin(RoadmapStore);
  await ctx.plugin(ReadMailboxTool);
  await ctx.plugin(RoadmapToolsPlugin);
  const mainFiber = ctx.plugin(MainSessionService, { model: { provider: "mock", model: "project-runtime-test" } });
  await mainFiber;
  const runtimeFiber = ctx.plugin(ProjectRuntime);
  await runtimeFiber;

  return { ctx, adapter, searchAdapter, runtimeFiber, nodeFiber, mainFiber };
}

export function createActor(ctx: Context, kind: "main" | "node") {
  const project = ctx.projects.create({ goal: `${kind} recovery` });
  const nodeId = kind === "node" ? createWorkNode(ctx, project.id, "Work").node.id : undefined;
  if (nodeId !== undefined) addRoadmap(ctx, project.id, [nodeId]);
  const runtime = ctx.projectRuntime;
  return {
    project, nodeId,
    start: (signal?: AbortSignal) => nodeId === undefined
      ? runtime.startMain({ projectId: project.id, text: "Human start", ...(signal ? { signal } : {}) })
      : runtime.startNode({ projectId: project.id, nodeId, text: "Human start", ...(signal ? { signal } : {}) }),
    next: () => nodeId === undefined
      ? runtime.startMain({ projectId: project.id, text: "Human continue" })
      : runtime.continueNode({ projectId: project.id, nodeId, text: "Human continue" }),
    stop: () => nodeId === undefined ? runtime.stopMain(project.id) : runtime.stopNode(project.id, nodeId),
    canContinue: () => nodeId === undefined
      ? runtime.canStartMain(project.id) : runtime.canContinueNode(project.id, nodeId),
  };
}

export function createWorkNode(ctx: Context, projectId: ProjectId, title: string) {
  return ctx.nodes.create({
    projectId,
    objective: {
      title,
      description: `Execute ${title}`,
      acceptanceCriteria: [`${title} complete`],
    },
  });
}

export function addRoadmap(ctx: Context, projectId: ProjectId, nodeIds: readonly NodeId[]) {
  ctx.roadmaps.create({
    definition: {
      projectId,
      nodes: [...nodeIds],
      edges: [],
    },
    reason: "Human-approved plan",
  });
}

export async function flushUntil(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 30 && !condition(); index += 1) {
    await Promise.resolve();
  }
  if (!condition()) throw new Error("expected asynchronous boundary was not reached");
}
