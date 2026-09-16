import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createSessionId } from "../../../src/brand/ids.js";
import { NodeStore } from "../../../src/node/store.js";
import { ProjectStore } from "../../../src/project/store.js";
import { RoadmapStore } from "../../../src/roadmap/store.js";
import { RoadmapToolsPlugin } from "../../../src/tools/builtins/roadmap/plugin.js";
import { READ_ROADMAP_TOOL_NAME } from "../../../src/tools/builtins/roadmap/read.js";
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

describe("read_roadmap", () => {
  it("returns empty as normal Project state when no roadmap exists", async () => {
    const ctx = await createContext();
    const project = ctx.projects.create({ goal: "Plan a Project" });

    const result = await ctx.tools.execute(
      toolCall("empty-roadmap", READ_ROADMAP_TOOL_NAME, {}),
      signal,
      { sessionId: project.mainSessionId, allowedTools: [READ_ROADMAP_TOOL_NAME] },
    );

    if (result.kind !== "success") throw new Error("read_roadmap unexpectedly failed");
    expect(result.block.content).toEqual([{
      type: "text",
      text: "Roadmap is empty.\nNo roadmap has been created for this Project.",
    }]);
    expect(result.artifact).toEqual({ state: "empty" });
  });

  it("returns a concise topological roadmap view without private Node state", async () => {
    const ctx = await createContext();
    const project = ctx.projects.create({ goal: "Ship a backend" });
    const research = ctx.nodes.create({
      projectId: project.id,
      objective: {
        title: "Research architecture",
        description: "Inspect the current architecture and constraints.",
        acceptanceCriteria: ["Architecture is documented"],
      },
    });
    const build = ctx.nodes.create({
      projectId: project.id,
      requirement: "optional",
      objective: {
        title: "Build prototype",
        description: "Implement the first backend prototype.",
        acceptanceCriteria: ["Prototype runs", "Integration path is documented"],
      },
    });
    ctx.roadmaps.create({
      definition: {
        projectId: project.id,
        nodes: [research.node.id, build.node.id],
        edges: [{ from: research.node.id, to: build.node.id }],
      },
      reason: "Initial plan",
    });

    const result = await ctx.tools.execute(
      toolCall("read-roadmap", READ_ROADMAP_TOOL_NAME, {}),
      signal,
      { sessionId: project.mainSessionId, allowedTools: [READ_ROADMAP_TOOL_NAME] },
    );

    if (result.kind !== "success") throw new Error("read_roadmap unexpectedly failed");
    const text = result.block.content[0]?.type === "text" ? result.block.content[0].text : "";
    expect(text).toContain("Roadmap version: 1");
    expect(text).toContain(`${research.node.id} -> ${build.node.id}`);
    expect(text).toContain(`[${research.node.id}] Research architecture`);
    expect(text).toContain("required: yes");
    expect(text).toContain(`depends_on: ${research.node.id}`);
    expect(text).toContain(`[${build.node.id}] Build prototype`);
    expect(text).toContain("required: no");
    expect(text).toContain("status: locked");
    expect(text).toContain("Done when:\n- Prototype runs\n- Integration path is documented");
    expect(JSON.stringify(result.artifact)).not.toContain("sessionId");
    expect(JSON.stringify(result.artifact)).not.toContain("confirmation");
    expect(result.artifact).toMatchObject({
      state: "ready",
      version: 1,
      nodes: [
        {
          id: String(research.node.id),
          title: "Research architecture",
          required: true,
          status: "idle",
          depends_on: [],
        },
        {
          id: String(build.node.id),
          title: "Build prototype",
          required: false,
          status: "locked",
          depends_on: [String(research.node.id)],
        },
      ],
    });
  });

  it("rejects a Node Session even if the tool is dispatched directly", async () => {
    const ctx = await createContext();
    const project = ctx.projects.create({ goal: "Protected Project" });
    const node = ctx.nodes.create({
      projectId: project.id,
      objective: {
        title: "Private work",
        description: "Stay within the Node scope.",
        acceptanceCriteria: ["Scope preserved"],
      },
    });
    ctx.nodes.unlock(node.node.id, "Ready for work");
    const nodeSession = createSessionId("node-roadmap-reader");
    ctx.nodes.bindSession(node.node.id, nodeSession);

    const result = await ctx.tools.execute(
      toolCall("node-read-roadmap", READ_ROADMAP_TOOL_NAME, {}),
      signal,
      { sessionId: nodeSession, allowedTools: [READ_ROADMAP_TOOL_NAME] },
    );

    if (result.kind !== "failure") throw new Error("Node Session unexpectedly read the Roadmap");
    expect(result.failure.code).toBe("tool-failed");
    expect(JSON.stringify(result.block.content)).toContain("available only to the Main Agent");
  });
});
