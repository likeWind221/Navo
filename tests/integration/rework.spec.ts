import { setImmediate } from "node:timers/promises";
import type { Context } from "cordis";
import { expect, it } from "vitest";
import type { ProjectId, SessionId } from "../../src/brand/ids.js";
import { projectNode } from "../../src/node/projector.js";
import { projectRoadmap } from "../../src/roadmap/projector.js";
import { createWorld } from "./rework/helpers.js";

async function state(app: Context, projectId: ProjectId, sessions: readonly SessionId[]) {
  return {
    project: app.projects.get(projectId),
    workspace: await app.projectWorkspaces.get(projectId),
    roadmap: app.roadmaps.get(projectId),
    nodes: app.nodes.getByProject(projectId),
    resources: app.resources.listByProject(projectId),
    mailbox: app.mailbox.getHistory(projectId),
    sessions: sessions.map(sessionId => app.sessions.getEvents(sessionId)),
  };
}

it("completes a Project through submission, Main rework, replanning and two restarts", { timeout: 20_000 }, async () => {
  const world = await createWorld();
  const { nodeId } = world;
  let app = await world.open();
  const project = app.projects.create({ name: "Project", goal: "Deliver a sourced recommendation" });
  await app.projectWorkspaces.create(project.id, world.root);
  const node = (key: string) => app.nodes.get(nodeId(key))!;
  const run = (key: string) => {
    const input = { projectId: project.id, nodeId: nodeId(key), text: "Work on this objective" };
    return node(key).sessionId === undefined ? app.projectRuntime.startNode(input) : app.projectRuntime.continueNode(input);
  };
  const review = (key: string) => app.projectRuntime.startReview({ projectId: project.id, nodeId: nodeId(key), text: "Review this Node" });
  const quiet = async (requests: number) => {
    await setImmediate();
    expect(world.requests()).toBe(requests);
  };

  const planned = await app.projectRuntime.startMain({ projectId: project.id, text: "Plan the Project" });
  expect(planned.turn).toMatchObject({ status: "completed", steps: 3 });
  expect(node("evidence").status).toBe("idle");
  expect(node("synthesis").status).toBe("locked");
  await quiet(3);

  const draft = await run("evidence");
  expect(draft.turn).toMatchObject({ status: "completed", steps: 2 });
  expect(node("evidence")).toMatchObject({ status: "submitted", submission: { summary: "Draft published" } });
  expect(node("evidence").confirmation).toBeUndefined();
  expect(node("synthesis").status).toBe("locked");
  expect(() => run("evidence")).toThrow();
  expect(app.reviews.isPending(node("evidence"))).toBe(true);
  await quiet(5);

  const returned = await review("evidence");
  expect(returned.turn).toMatchObject({ status: "completed", steps: 3 });
  expect(returned.sessionId).toBe(planned.sessionId);
  expect(node("evidence")).toMatchObject({
    status: "idle", reworkCount: 1,
    pendingFeedback: { requestedBy: "main", feedback: expect.stringContaining("REWORK_FEEDBACK") },
    lastReview: { decision: "rework", turnId: draft.turn.turnId },
  });
  expect(node("evidence").submission).toBeUndefined();
  expect(node("synthesis").status).toBe("locked");
  expect(app.reviews.isPending(node("evidence"))).toBe(false);
  await quiet(8);

  const sessions = [planned.sessionId, draft.sessionId];
  const beforeFirst = await state(app, project.id, sessions);
  app = await world.restart(app);
  expect(await state(app, project.id, sessions)).toEqual(beforeFirst);
  expect(app.reviews.isPending(node("evidence"))).toBe(false);
  await quiet(8);

  const sourced = await run("evidence");
  expect(sourced.turn).toMatchObject({ status: "completed", steps: 2 });
  expect(sourced.sessionId).toBe(draft.sessionId);
  expect(node("evidence")).toMatchObject({ status: "submitted", reworkCount: 1 });
  expect(node("evidence").pendingFeedback).toBeUndefined();
  await quiet(10);

  const completed = await review("evidence");
  expect(completed.turn).toMatchObject({ status: "completed", steps: 7 });
  expect(completed.sessionId).toBe(planned.sessionId);
  expect(node("evidence")).toMatchObject({
    status: "completing", confirmation: { confirmedBy: "main" }, lastReview: { decision: "complete", turnId: sourced.turn.turnId },
  });
  expect(app.roadmaps.get(project.id)?.revision).toBe(3);
  expect(app.roadmaps.get(project.id)?.graph.definition.edges).toEqual(expect.arrayContaining([
    { from: nodeId("evidence"), to: nodeId("synthesis") },
    { from: nodeId("evidence"), to: nodeId("validation") },
    { from: nodeId("validation"), to: nodeId("synthesis") },
  ]));
  expect(node("validation").status).toBe("idle");
  expect(node("synthesis").status).toBe("locked");
  await quiet(17);

  const refused = await review("validation");
  expect(refused.turn).toMatchObject({ status: "completed", steps: 3 });
  expect(node("validation")).toMatchObject({ status: "idle", lastReview: { decision: "escalate" } });
  expect(node("validation").confirmation).toBeUndefined();
  expect(node("synthesis").status).toBe("locked");
  await quiet(20);

  const validation = await run("validation");
  expect(validation.turn).toMatchObject({ status: "completed", steps: 2 });
  expect(node("validation").status).toBe("submitted");
  const validated = await review("validation");
  expect(validated.turn).toMatchObject({ status: "completed", steps: 5 });
  expect(node("validation")).toMatchObject({ status: "completing", confirmation: { confirmedBy: "main" } });
  expect(node("synthesis").status).toBe("idle");
  await quiet(27);

  const synthesis = await run("synthesis");
  expect(synthesis.turn).toMatchObject({ status: "completed", steps: 4 });
  expect(node("synthesis").status).toBe("submitted");
  const finished = await review("synthesis");
  expect(finished.turn).toMatchObject({ status: "completed", steps: 3 });
  await quiet(34);
  expect(world.remaining()).toBe(0);

  const turns = [planned, draft, returned, sourced, completed, refused, validation, validated, synthesis, finished];
  const allSessions = [...new Set(turns.map(turn => turn.sessionId))];
  expect(allSessions).toHaveLength(4);
  const beforeSecond = await state(app, project.id, allSessions);
  app = await world.restart(app);
  expect(await state(app, project.id, allSessions)).toEqual(beforeSecond);
  await quiet(34);

  expect(app.nodes.getByProject(project.id).map(value => [value.status, value.confirmation?.confirmedBy]))
    .toEqual([["completing", "main"], ["completing", "main"], ["completing", "main"]]);
  expect(app.projects.get(project.id)?.status).toBe("active");
  expect(Object.fromEntries(app.resources.listByProject(project.id).map(resource => [resource.name, resource.access.kind])))
    .toEqual({ draft: "private", sourced: "shared", validation: "shared" });
  for (const value of app.nodes.getByProject(project.id)) {
    expect(projectNode(value.node.id, app.nodes.getEvents(value.node.id))).toEqual(value);
  }
  expect(projectRoadmap(project.id, app.roadmaps.getEvents(project.id), app.nodes.getByProject(project.id).map(value => value.node)))
    .toEqual(app.roadmaps.get(project.id));
  const failures: string[] = [];
  for (const sessionId of allSessions) {
    const events = app.sessions.getEvents(sessionId);
    const expected = turns.filter(turn => turn.sessionId === sessionId).length;
    expect(events.filter(event => event.type === "turn-started")).toHaveLength(expected);
    expect(events.filter(event => event.type === "turn-ended")).toHaveLength(expected);
    for (const event of events.filter(event => event.type === "error")) {
      expect(event.data.source).toBe("tool");
      failures.push(String(event.data.toolCallId));
    }
  }
  expect(failures).toEqual(["never-ran"]);
});
