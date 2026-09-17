import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createSessionId } from "../../../src/brand/ids.js";
import { NodeStore } from "../../../src/node/store.js";
import { ProjectStore } from "../../../src/project/store.js";
import { RoadmapToolsPlugin } from "../../../src/tools/builtins/roadmap/plugin.js";
import { READ_NODE_TOOL_NAME } from "../../../src/tools/builtins/roadmap/read-node.js";
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
  await ctx.plugin(RoadmapToolsPlugin);
  return ctx;
}

describe("read_node", () => {
  it("returns the current work Node definition and revision without private execution state", async () => {
    const ctx = await createContext();
    const project = ctx.projects.create({ goal: "Ship a backend" });
    const created = ctx.nodes.create({
      projectId: project.id,
      requirement: "optional",
      objective: {
        title: "Build prototype",
        description: "Implement the first backend prototype.",
        acceptanceCriteria: ["Prototype runs", "Integration path is documented"],
      },
    });
    const node = ctx.nodes.unlock(created.node.id, "Ready");
    const nodeSession = createSessionId("private-node-session");
    ctx.nodes.bindSession(node.node.id, nodeSession);

    const result = await ctx.tools.execute(
      toolCall("read-node", READ_NODE_TOOL_NAME, { node_id: String(node.node.id) }),
      signal,
      { sessionId: project.mainSessionId, allowedTools: [READ_NODE_TOOL_NAME] },
    );

    if (result.kind !== "success") throw new Error("read_node unexpectedly failed");
    const text = result.block.content[0]?.type === "text" ? result.block.content[0].text : "";
    expect(text).toContain(`Node: ${node.node.id}`);
    expect(text).toContain("version: 3");
    expect(text).toContain("title: Build prototype");
    expect(text).toContain("kind: work");
    expect(text).toContain("required: no");
    expect(text).toContain("status: idle");
    expect(text).toContain("Task: Implement the first backend prototype.");
    expect(text).toContain("Done when:\n- Prototype runs\n- Integration path is documented");
    expect(result.artifact).toEqual({
      id: String(node.node.id),
      version: 3,
      title: "Build prototype",
      kind: "work",
      required: false,
      status: "idle",
      task: "Implement the first backend prototype.",
      done_when: ["Prototype runs", "Integration path is documented"],
    });
    expect(JSON.stringify(result.artifact)).not.toContain("sessionId");
    expect(JSON.stringify(result.artifact)).not.toContain("confirmation");
  });

  it("projects control Nodes without inventing work fields", async () => {
    const ctx = await createContext();
    const project = ctx.projects.create({ goal: "Run checkpoints" });
    const node = ctx.nodes.create({
      projectId: project.id,
      kind: "control",
      purpose: "checkpoint",
      title: "Architecture review",
    });

    const result = await ctx.tools.execute(
      toolCall("read-control-node", READ_NODE_TOOL_NAME, { node_id: String(node.node.id) }),
      signal,
      { sessionId: project.mainSessionId, allowedTools: [READ_NODE_TOOL_NAME] },
    );

    if (result.kind !== "success") throw new Error("read_node unexpectedly failed");
    expect(result.artifact).toEqual({
      id: String(node.node.id),
      version: 1,
      title: "Architecture review",
      kind: "control",
      required: true,
      status: "locked",
      control: "checkpoint",
    });
  });

  it("does not reveal a Node owned by another Project", async () => {
    const ctx = await createContext();
    const projectA = ctx.projects.create({ goal: "Project A" });
    const projectB = ctx.projects.create({ goal: "Project B" });
    const foreignNode = ctx.nodes.create({
      projectId: projectB.id,
      objective: {
        title: "Foreign Node",
        description: "Must stay in Project B.",
        acceptanceCriteria: ["No cross-project access"],
      },
    });

    const result = await ctx.tools.execute(
      toolCall("foreign-node", READ_NODE_TOOL_NAME, { node_id: String(foreignNode.node.id) }),
      signal,
      { sessionId: projectA.mainSessionId, allowedTools: [READ_NODE_TOOL_NAME] },
    );

    if (result.kind !== "failure") throw new Error("cross-project read_node unexpectedly succeeded");
    expect(result.failure.code).toBe("tool-failed");
    expect(JSON.stringify(result.block.content)).toContain("does not exist in the current Project");
    expect(JSON.stringify(result.block.content)).not.toContain("Project B");
  });

  it("rejects a Node Session even if the tool is dispatched directly", async () => {
    const ctx = await createContext();
    const project = ctx.projects.create({ goal: "Protected Project" });
    const node = ctx.nodes.create({
      projectId: project.id,
      objective: {
        title: "Scoped Node",
        description: "Stay in Node scope.",
        acceptanceCriteria: ["Scope preserved"],
      },
    });
    ctx.nodes.unlock(node.node.id, "Ready");
    const nodeSession = createSessionId("node-read-node");
    ctx.nodes.bindSession(node.node.id, nodeSession);

    const result = await ctx.tools.execute(
      toolCall("node-read-node", READ_NODE_TOOL_NAME, { node_id: String(node.node.id) }),
      signal,
      { sessionId: nodeSession, allowedTools: [READ_NODE_TOOL_NAME] },
    );

    if (result.kind !== "failure") throw new Error("Node Session unexpectedly used read_node");
    expect(result.failure.code).toBe("tool-failed");
    expect(JSON.stringify(result.block.content)).toContain("available only to the Main Agent");
  });
});
