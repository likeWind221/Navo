import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createSessionId } from "../../../src/brand/ids.js";
import { NodeStore } from "../../../src/node/store.js";
import { ProjectStore } from "../../../src/project/store.js";
import { RoadmapStore } from "../../../src/roadmap/store.js";
import { SET_PROJECT_GOAL_TOOL_NAME, SetProjectGoalTool } from "../../../src/tools/builtins/project/goal.js";
import { ToolService } from "../../../src/tools/service.js";
import { toolCall } from "../../helpers/tools.js";
import { memoryStorage } from "../../helpers/storage.js";

const contexts = new Set<Context>();
const signal = new AbortController().signal;

afterEach(async () => {
  await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
  contexts.clear();
});

async function createContext(): Promise<Context> {
  const ctx = new Context();
  contexts.add(ctx);
  await memoryStorage(ctx);
  await ctx.plugin(ProjectStore);
  await ctx.plugin(NodeStore);
  await ctx.plugin(ToolService);
  await ctx.plugin(RoadmapStore);
  await ctx.plugin(SetProjectGoalTool);
  return ctx;
}

function setGoal(ctx: Context, sessionId: string, goal: unknown) {
  return ctx.tools.execute(
    toolCall(`set-goal-${Math.random()}`, SET_PROJECT_GOAL_TOOL_NAME, { goal }),
    signal,
    { sessionId: createSessionId(sessionId), allowedTools: [SET_PROJECT_GOAL_TOOL_NAME] },
  );
}

describe("set_project_goal", () => {
  it("records a trimmed goal for the Main Agent and rejects blank or oversized goals", async () => {
    const ctx = await createContext();
    const project = ctx.projects.create({ name: "Project", goal: null });

    const blank = await setGoal(ctx, project.mainSessionId, "   ");
    if (blank.kind !== "failure") throw new Error("blank goal unexpectedly accepted");
    expect(JSON.stringify(blank.block.content)).toContain("non-blank text of at most 8000 characters");
    const oversized = await setGoal(ctx, project.mainSessionId, "x".repeat(8_001));
    expect(oversized.kind).toBe("failure");

    const result = await setGoal(ctx, project.mainSessionId, "  Compare vector stores  ");
    if (result.kind !== "success") throw new Error("set_project_goal unexpectedly failed");
    expect(ctx.projects.get(project.id)).toMatchObject({ goal: "Compare vector stores", revision: 2 });
  });

  it("locks the goal once the Roadmap exists and refuses Node or archived callers", async () => {
    const ctx = await createContext();
    const project = ctx.projects.create({ name: "Project", goal: "Original goal" });
    const node = ctx.nodes.create({
      projectId: project.id,
      objective: { title: "Worker", description: "Work", acceptanceCriteria: ["Done"] },
    });
    ctx.nodes.unlock(node.node.id, "Ready");
    ctx.nodes.bindSession(node.node.id, createSessionId("node-goal"));

    const fromNode = await setGoal(ctx, "node-goal", "Hijack");
    if (fromNode.kind !== "failure") throw new Error("Node Session unexpectedly set the goal");
    expect(JSON.stringify(fromNode.block.content)).toContain("available only to the Main Agent");

    ctx.roadmaps.create({ definition: { projectId: project.id, nodes: [node.node.id], edges: [] }, reason: "Plan" });
    const locked = await setGoal(ctx, project.mainSessionId, "Different goal");
    if (locked.kind !== "failure") throw new Error("goal unexpectedly changed after planning");
    expect(JSON.stringify(locked.block.content)).toContain("goal is locked");
    expect(ctx.projects.get(project.id)?.goal).toBe("Original goal");

    const draft = ctx.projects.create({ name: "Draft", goal: null });
    ctx.projects.archive(draft.id, "Paused");
    const archived = await setGoal(ctx, draft.mainSessionId, "Late goal");
    if (archived.kind !== "failure") throw new Error("archived Project goal unexpectedly changed");
    expect(JSON.stringify(archived.block.content)).toContain("only while the current Project is active");
  });
});
