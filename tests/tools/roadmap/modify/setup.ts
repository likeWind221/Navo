import { Context } from "cordis";
import { afterEach } from "vitest";

import type { SessionId } from "../../../../src/brand/ids.js";
import { NodeStore } from "../../../../src/node/store.js";
import { ProjectStore } from "../../../../src/project/store.js";
import { RoadmapStore } from "../../../../src/roadmap/store.js";
import { RoadmapToolsPlugin } from "../../../../src/tools/builtins/roadmap/plugin.js";
import { ToolService } from "../../../../src/tools/service.js";
import { toolCall } from "../../../helpers/tools.js";
import { memoryStorage } from "../../../helpers/storage.js";

const contexts = new Set<Context>();
const signal = new AbortController().signal;

afterEach(async () => {
  await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
  contexts.clear();
});

export async function createRoadmap() {
  const ctx = new Context();
  contexts.add(ctx);
  await memoryStorage(ctx);
  await ctx.plugin(ProjectStore);
  await ctx.plugin(NodeStore);
  await ctx.plugin(ToolService);
  await ctx.plugin(RoadmapStore);
  await ctx.plugin(RoadmapToolsPlugin);
  const project = ctx.projects.create({ name: "Project", goal: "Ship a backend" });
  const design = ctx.nodes.create({
    projectId: project.id,
    objective: {
      title: "Design architecture",
      description: "Define the backend architecture.",
      acceptanceCriteria: ["Architecture documented"],
    },
  });
  const build = ctx.nodes.create({
    projectId: project.id,
    objective: {
      title: "Build backend",
      description: "Implement the backend.",
      acceptanceCriteria: ["Backend runs"],
    },
  });
  ctx.roadmaps.create({
    definition: {
      projectId: project.id,
      nodes: [design.node.id, build.node.id],
      edges: [{ from: design.node.id, to: build.node.id }],
    },
    reason: "Initial plan",
  });
  return { ctx, project, designId: design.node.id, buildId: build.node.id };
}

export async function execute(ctx: Context, sessionId: SessionId, name: string, arguments_: Record<string, unknown>) {
  return ctx.tools.execute(toolCall(`call-${name}`, name, arguments_), signal, { sessionId, allowedTools: [name] });
}
