import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { NodeStore } from "../../../src/node/store.js";
import { ProjectStore } from "../../../src/project/store.js";
import { RoadmapStore } from "../../../src/roadmap/store.js";
import { RoadmapToolsPlugin } from "../../../src/tools/builtins/roadmap/plugin.js";
import { WRITE_ROADMAP_TOOL_NAME } from "../../../src/tools/builtins/roadmap/write-roadmap.js";
import { ToolService } from "../../../src/tools/service.js";
import { toolCall } from "../../helpers/tools.js";

const contexts = new Set<Context>();
const signal = new AbortController().signal;

afterEach(async () => {
  await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
  contexts.clear();
});

async function createContext(): Promise<Context> {
  const ctx = new Context();
  contexts.add(ctx);
  await ctx.plugin(ProjectStore);
  await ctx.plugin(NodeStore);
  await ctx.plugin(ToolService);
  await ctx.plugin(RoadmapStore);
  await ctx.plugin(RoadmapToolsPlugin);
  return ctx;
}

describe("write_roadmap creation receipt", () => {
  it("maps proposal-local keys to persistent Node IDs without persisting the keys", async () => {
    const ctx = await createContext();
    const project = ctx.projects.create({ goal: "Ship a backend" });

    const result = await ctx.tools.execute(
      toolCall("write-roadmap-receipt", WRITE_ROADMAP_TOOL_NAME, {
        reason: "Initial plan",
        nodes: [
          {
            key: "design",
            kind: "work",
            title: "Design backend",
            goal: "Define the backend architecture.",
            done_when: ["Architecture is documented"],
            required: true,
            depends_on: [],
          },
          {
            key: "build",
            kind: "work",
            title: "Build backend",
            goal: "Implement the backend.",
            done_when: ["Backend runs"],
            required: true,
            depends_on: ["design"],
          },
        ],
      }),
      signal,
      { sessionId: project.mainSessionId, allowedTools: [WRITE_ROADMAP_TOOL_NAME] },
    );

    if (result.kind !== "success") throw new Error("write_roadmap unexpectedly failed");
    const roadmap = ctx.roadmaps.get(project.id)!;
    const [designId, buildId] = roadmap.graph.definition.nodes.map(String);

    expect(result.artifact).toMatchObject({
      state: "ready",
      version: 1,
      created_nodes: {
        design: designId,
        build: buildId,
      },
    });
    const text = result.block.content[0]?.type === "text" ? result.block.content[0].text : "";
    expect(text).toContain("Created Node mapping:");
    expect(text).toContain(`- design -> ${designId}`);
    expect(text).toContain(`- build -> ${buildId}`);

    expect(ctx.nodes.getByProject(project.id).map((node) => JSON.stringify(node.node)))
      .not.toEqual(expect.arrayContaining([expect.stringContaining("design"), expect.stringContaining("build")]));
  });
});
