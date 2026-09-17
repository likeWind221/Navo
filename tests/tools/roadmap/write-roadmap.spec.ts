import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createSessionId } from "../../../src/brand/ids.js";
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

const initialProposal = {
  reason: "Initial execution plan",
  nodes: [
    {
      key: "research",
      kind: "work",
      title: "Research architecture",
      goal: "Understand the existing architecture and constraints.",
      done_when: ["Architecture constraints are documented"],
      required: true,
      depends_on: [],
    },
    {
      key: "review",
      kind: "control",
      title: "Architecture checkpoint",
      control: "checkpoint",
      required: true,
      depends_on: ["research"],
    },
    {
      key: "build",
      kind: "work",
      title: "Build prototype",
      goal: "Implement the first working prototype.",
      done_when: ["Prototype runs", "Integration path is documented"],
      required: false,
      depends_on: ["review"],
    },
  ],
} as const;

describe("write_roadmap", () => {
  it("creates the initial Roadmap and its Nodes atomically with Navo-generated identities", async () => {
    const ctx = await createContext();
    const project = ctx.projects.create({ goal: "Ship a backend" });

    const result = await ctx.tools.execute(
      toolCall("write-roadmap", WRITE_ROADMAP_TOOL_NAME, initialProposal),
      signal,
      { sessionId: project.mainSessionId, allowedTools: [WRITE_ROADMAP_TOOL_NAME] },
    );

    if (result.kind !== "success") throw new Error("write_roadmap unexpectedly failed");
    const roadmap = ctx.roadmaps.get(project.id);
    const nodes = ctx.nodes.getByProject(project.id);
    expect(roadmap?.revision).toBe(1);
    expect(nodes).toHaveLength(3);
    expect(roadmap?.graph.definition.nodes).toEqual(nodes.map((node) => node.node.id));
    expect(nodes.map((node) => node.status)).toEqual(["idle", "locked", "locked"]);
    expect(nodes.map((node) => String(node.node.id))).not.toContain("research");
    expect(ctx.roadmaps.getEvents(project.id)[0]?.reason).toBe("Initial execution plan");

    expect(result.artifact).toMatchObject({
      state: "ready",
      version: 1,
      nodes: [
        {
          title: "Research architecture",
          kind: "work",
          goal: "Understand the existing architecture and constraints.",
          done_when: ["Architecture constraints are documented"],
          required: true,
          status: "idle",
          depends_on: [],
        },
        {
          title: "Architecture checkpoint",
          kind: "control",
          control: "checkpoint",
          required: true,
          status: "locked",
        },
        {
          title: "Build prototype",
          kind: "work",
          goal: "Implement the first working prototype.",
          done_when: ["Prototype runs", "Integration path is documented"],
          required: false,
          status: "locked",
        },
      ],
    });
    expect(JSON.stringify(result.artifact)).not.toContain("sessionId");
    expect(JSON.stringify(result.artifact)).not.toContain("confirmation");
  });

  it("rejects cyclic dependencies without leaving orphan Nodes or a partial Roadmap", async () => {
    const ctx = await createContext();
    const project = ctx.projects.create({ goal: "Protected plan" });

    const result = await ctx.tools.execute(
      toolCall("cyclic-roadmap", WRITE_ROADMAP_TOOL_NAME, {
        reason: "Bad cycle",
        nodes: [
          {
            key: "a", kind: "work", title: "A", goal: "Do A", done_when: ["A done"],
            required: true, depends_on: ["b"],
          },
          {
            key: "b", kind: "work", title: "B", goal: "Do B", done_when: ["B done"],
            required: true, depends_on: ["a"],
          },
        ],
      }),
      signal,
      { sessionId: project.mainSessionId, allowedTools: [WRITE_ROADMAP_TOOL_NAME] },
    );

    if (result.kind !== "failure") throw new Error("cyclic write_roadmap unexpectedly succeeded");
    expect(JSON.stringify(result.block.content)).toContain("dependencies contain a cycle");
    expect(ctx.roadmaps.get(project.id)).toBeUndefined();
    expect(ctx.nodes.getByProject(project.id)).toEqual([]);
  });

  it("does not replace an existing Roadmap", async () => {
    const ctx = await createContext();
    const project = ctx.projects.create({ goal: "Stable plan" });

    const first = await ctx.tools.execute(
      toolCall("first-roadmap", WRITE_ROADMAP_TOOL_NAME, initialProposal),
      signal,
      { sessionId: project.mainSessionId, allowedTools: [WRITE_ROADMAP_TOOL_NAME] },
    );
    if (first.kind !== "success") throw new Error("initial write_roadmap unexpectedly failed");
    const before = ctx.roadmaps.get(project.id)!;
    const nodeIds = ctx.nodes.getByProject(project.id).map((node) => node.node.id);

    const second = await ctx.tools.execute(
      toolCall("replace-roadmap", WRITE_ROADMAP_TOOL_NAME, {
        reason: "Replace it",
        nodes: [{
          key: "replacement", kind: "work", title: "Replacement", goal: "Replace plan",
          done_when: ["Replacement done"], required: true, depends_on: [],
        }],
      }),
      signal,
      { sessionId: project.mainSessionId, allowedTools: [WRITE_ROADMAP_TOOL_NAME] },
    );

    if (second.kind !== "failure") throw new Error("write_roadmap unexpectedly replaced an existing Roadmap");
    expect(JSON.stringify(second.block.content)).toContain("already exists");
    expect(ctx.roadmaps.get(project.id)).toBe(before);
    expect(ctx.nodes.getByProject(project.id).map((node) => node.node.id)).toEqual(nodeIds);
  });

  it("rejects a Node Session even if write_roadmap is dispatched directly", async () => {
    const ctx = await createContext();
    const project = ctx.projects.create({ goal: "Protected Project" });
    const node = ctx.nodes.create({
      projectId: project.id,
      objective: {
        title: "Worker",
        description: "Execute assigned work.",
        acceptanceCriteria: ["Work reported"],
      },
    });
    ctx.nodes.unlock(node.node.id, "Ready");
    const nodeSession = createSessionId("node-write-roadmap");
    ctx.nodes.bindSession(node.node.id, nodeSession);

    const result = await ctx.tools.execute(
      toolCall("node-write-roadmap", WRITE_ROADMAP_TOOL_NAME, initialProposal),
      signal,
      { sessionId: nodeSession, allowedTools: [WRITE_ROADMAP_TOOL_NAME] },
    );

    if (result.kind !== "failure") throw new Error("Node Session unexpectedly used write_roadmap");
    expect(JSON.stringify(result.block.content)).toContain("available only to the Main Agent");
    expect(ctx.roadmaps.get(project.id)).toBeUndefined();
  });
});
