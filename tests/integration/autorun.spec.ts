import { describe, expect, it } from "vitest";

import { createNodeId, type ProjectId } from "../../src/brand/ids.js";
import { projectNode } from "../../src/node/projector.js";
import { projectRoadmap } from "../../src/roadmap/projector.js";
import { createWorld, flushUntil } from "./autorun/helpers.js";
import { failureScenario, reworkSkipScenario } from "./autorun/script.js";

async function durableState(app: Awaited<ReturnType<typeof createWorld>> extends infer _ ? never : never, _projectId: ProjectId) {
  throw new Error("unreachable");
}

async function state(app: import("cordis").Context, projectId: ProjectId) {
  const sessions = app.nodes.getByProject(projectId)
    .map(node => node.sessionId)
    .filter((sessionId): sessionId is string => sessionId !== undefined);
  return {
    project: app.projects.get(projectId),
    workspace: await app.projectWorkspaces.get(projectId),
    roadmap: app.roadmaps.get(projectId),
    nodes: app.nodes.getByProject(projectId),
    sessions: sessions.map(sessionId => app.sessions.getEvents(sessionId)),
  };
}

function createProject(app: import("cordis").Context, workspaceRoot: string, titles: readonly string[]) {
  const project = app.projects.create({ name: "AutoRun Project", goal: "Complete the approved work plan." });
  return app.projectWorkspaces.create(project.id, workspaceRoot).then(() => {
    const nodes = titles.map(title => app.nodes.create({
      projectId: project.id,
      objective: {
        title,
        description: `Execute ${title}`,
        acceptanceCriteria: [`${title} complete`],
      },
    }));
    const nodeIds = nodes.map(node => node.node.id);
    app.roadmaps.create({
      definition: {
        projectId: project.id,
        nodes: nodeIds,
        edges: nodeIds.length === 2 ? [{ from: nodeIds[0]!, to: nodeIds[1]! }] : [],
      },
      reason: "Human-approved plan",
    });
    return { project, nodeIds };
  });
}

describe("F11.4 long-term AutoRun acceptance", () => {
  it("survives a pause and restart, then completes rework, dependency and skip flow", async () => {
    const world = await createWorld(reworkSkipScenario());
    let app = await world.open();
    const { project, nodeIds } = await createProject(app, world.workspaceRoot, ["Draft", "Optional"]);

    const running = app.autoRun.start(project.id);
    await flushUntil(() => world.requests() === 1);
    expect(app.autoRun.pause(project.id)).toMatchObject({
      status: "running",
      nodeTurns: 0,
      mainTurns: 0,
    });

    const paused = await running;
    expect(paused).toMatchObject({
      status: "paused",
      reason: "human-paused",
      nodeTurns: 1,
      mainTurns: 0,
      currentTarget: { kind: "node", nodeId: nodeIds[0] },
    });
    expect(app.nodes.get(nodeIds[0]!)?.status).toBe("submitted");
    expect(app.nodes.get(nodeIds[1]!)?.status).toBe("locked");

    const beforeRestart = await state(app, project.id);
    app = await world.restart(app);
    expect(await state(app, project.id)).toEqual(beforeRestart);
    expect(app.autoRun.get(project.id)).toBeUndefined();
    expect(world.requests()).toBe(1);

    const resumed = await app.autoRun.resume(project.id);
    expect(resumed).toMatchObject({
      status: "completed",
      reason: "roadmap-complete",
      nodeTurns: 2,
      mainTurns: 3,
    });
    expect(resumed.runId).not.toBe(paused.runId);
    expect(app.nodes.get(nodeIds[0]!)).toMatchObject({
      status: "completing",
      reworkCount: 1,
      lastReview: { decision: "complete" },
      confirmation: { confirmedBy: "main" },
    });
    expect(app.nodes.get(nodeIds[1]!)).toMatchObject({
      status: "skipped",
      lastReview: { decision: "skip" },
    });
    expect(world.requests()).toBe(6);
    expect(app.autoRun.get(project.id)).toBeUndefined();

    const finalState = await state(app, project.id);
    for (const node of finalState.nodes) {
      expect(projectNode(node.node.id, app.nodes.getEvents(node.node.id))).toEqual(node);
    }
    expect(projectRoadmap(project.id, app.roadmaps.getEvents(project.id), finalState.nodes.map(node => node.node)))
      .toEqual(finalState.roadmap);
  });

  it("pauses on a failed Turn, does not retry, and resumes only after restart", async () => {
    const world = await createWorld(failureScenario());
    let app = await world.open();
    const { project, nodeIds } = await createProject(app, world.workspaceRoot, ["Recover"]);

    const failed = await app.autoRun.start(project.id);
    expect(failed).toMatchObject({
      status: "paused",
      reason: "turn-failed",
      nodeTurns: 1,
      mainTurns: 0,
    });
    expect(app.nodes.get(nodeIds[0]!)?.status).toBe("idle");
    expect(world.requests()).toBe(1);

    const beforeRestart = await state(app, project.id);
    app = await world.restart(app);
    expect(await state(app, project.id)).toEqual(beforeRestart);
    expect(app.autoRun.get(project.id)).toBeUndefined();
    expect(world.requests()).toBe(1);

    const resumed = await app.autoRun.resume(project.id);
    expect(resumed).toMatchObject({
      status: "completed",
      reason: "roadmap-complete",
      nodeTurns: 1,
      mainTurns: 1,
    });
    expect(app.nodes.get(nodeIds[0]!)).toMatchObject({
      status: "completing",
      confirmation: { confirmedBy: "main" },
    });
    expect(world.requests()).toBe(3);
  });
});
