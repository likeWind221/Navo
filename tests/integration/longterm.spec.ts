import { setImmediate } from "node:timers/promises";
import { expect, it } from "vitest";
import { projectNode } from "../../src/node/projector.js";
import { projectRoadmap } from "../../src/roadmap/projector.js";
import { confirm, createScenario } from "./longterm/helpers.js";

it("completes a Human-controlled long-term Project through planning, handoff, blocker and replanning", async () => {
  const { app, project, adapter, nodeId } = await createScenario();
  const main = () => app.projectRuntime.startMain({ projectId: project.id, text: "Review current Project facts and coordinate the next action" });
  const start = (key: string) => app.projectRuntime.startNode({ projectId: project.id, nodeId: nodeId(key), text: "Execute this objective" });
  const next = () => app.projectRuntime.continueNode({ projectId: project.id, nodeId: nodeId("synthesis"), text: "Continue using the new resources" });
  const quiet = async (requests: number) => {
    await setImmediate();
    expect(adapter.requests).toHaveLength(requests);
  };
  expect(app.roadmaps.get(project.id)).toBeUndefined();
  await quiet(0);

  const planned = await main();
  expect(planned.turn).toMatchObject({ status: "completed", steps: 3 });
  expect(app.roadmaps.get(project.id)?.revision).toBe(1);
  expect(app.nodes.getByProject(project.id)).toHaveLength(2);
  expect(app.nodes.get(nodeId("evidence"))?.status).toBe("idle");
  expect(app.nodes.get(nodeId("synthesis"))?.status).toBe("locked");
  expect(() => start("synthesis")).toThrow();
  await quiet(3);

  const evidence = await start("evidence");
  expect(evidence.turn).toMatchObject({ status: "completed", steps: 3 });
  expect(app.nodes.get(nodeId("evidence"))?.status).toBe("idle");
  const resourceA = app.resources.listByProject(project.id)[0]!;
  expect(resourceA).toMatchObject({ owner: { kind: "node", nodeId: nodeId("evidence") }, access: { kind: "private" }, revision: 1 });
  expect(app.resources.getVisible(project.id, resourceA.id, { kind: "node", nodeId: nodeId("synthesis") })).toBeUndefined();
  expect(app.mailbox.getHistory(project.id)).toHaveLength(1);
  await quiet(6);
  confirm(app, project.id, nodeId("evidence"));
  expect(app.nodes.get(nodeId("synthesis"))?.status).toBe("idle");
  expect(app.nodes.get(nodeId("synthesis"))?.sessionId).toBeUndefined();
  await quiet(6);

  const handed = await main();
  expect(handed.turn).toMatchObject({ status: "completed", steps: 3 });
  expect(handed.sessionId).toBe(project.mainSessionId);
  expect(app.resources.getVisible(project.id, resourceA.id, { kind: "node", nodeId: nodeId("synthesis") })?.revision).toBe(2);
  expect(app.nodes.get(nodeId("synthesis"))?.sessionId).toBeUndefined();
  await quiet(9);

  const blocked = await start("synthesis");
  expect(blocked.turn).toMatchObject({ status: "completed", steps: 4 });
  expect(app.nodes.get(nodeId("synthesis"))?.status).toBe("idle");
  expect(app.roadmaps.get(project.id)?.revision).toBe(1);
  expect(app.mailbox.getHistory(project.id).at(-1)?.body).toContain("BLOCKER");
  await quiet(13);

  const replanned = await main();
  expect(replanned.turn).toMatchObject({ status: "completed", steps: 7 });
  expect(app.roadmaps.get(project.id)?.revision).toBe(3);
  expect(app.nodes.getByProject(project.id)).toHaveLength(3);
  expect(app.nodes.get(nodeId("synthesis"))?.status).toBe("locked");
  expect(app.nodes.get(nodeId("synthesis"))?.sessionId).toBe(blocked.sessionId);
  expect(app.nodes.get(nodeId("validation"))?.status).toBe("idle");
  expect(app.nodes.get(nodeId("validation"))?.sessionId).toBeUndefined();
  expect(() => next()).toThrow();
  expect(app.roadmaps.get(project.id)?.graph.definition.edges).toEqual(expect.arrayContaining([
    { from: nodeId("evidence"), to: nodeId("synthesis") },
    { from: nodeId("evidence"), to: nodeId("validation") },
    { from: nodeId("validation"), to: nodeId("synthesis") },
  ]));
  await quiet(20);

  const validation = await start("validation");
  expect(validation.turn).toMatchObject({ status: "completed", steps: 4 });
  expect(app.nodes.get(nodeId("validation"))?.status).toBe("idle");
  expect(app.nodes.get(nodeId("synthesis"))?.status).toBe("locked");
  expect(app.resources.listByProject(project.id)).toHaveLength(2);
  await quiet(24);
  const coordinated = await main();
  expect(coordinated.turn).toMatchObject({ status: "completed", steps: 3 });
  expect(app.nodes.get(nodeId("synthesis"))?.status).toBe("locked");
  expect(() => next()).toThrow();
  await quiet(27);
  confirm(app, project.id, nodeId("validation"));
  expect(app.nodes.get(nodeId("synthesis"))?.status).toBe("idle");
  await quiet(27);

  const finished = await next();
  expect(finished.turn).toMatchObject({ status: "completed", steps: 2 });
  expect(finished.sessionId).toBe(blocked.sessionId);
  expect(app.nodes.get(nodeId("synthesis"))?.status).toBe("idle");
  confirm(app, project.id, nodeId("synthesis"));
  await quiet(29);
  expect(adapter.remainingEntries).toBe(0);
  expect(app.nodes.getByProject(project.id).map(node => node.status)).toEqual(["completing", "completing", "completing"]);
  expect(app.projects.get(project.id)?.status).toBe("active");
  expect(app.mailbox.getHistory(project.id).map(message => message.sender)).toEqual([
    { kind: "node", nodeId: nodeId("evidence") }, { kind: "node", nodeId: nodeId("synthesis") }, { kind: "node", nodeId: nodeId("validation") },
  ]);

  const turns = [planned, evidence, handed, blocked, replanned, validation, coordinated, finished];
  expect(new Set(turns.map(value => value.sessionId)).size).toBe(4);
  const permittedFailures = ["forbidden-replan", "stale-connect", "private-fetch"];
  const failures: string[] = [];
  for (const sessionId of new Set(turns.map(value => value.sessionId))) {
    const events = app.sessions.getEvents(sessionId);
    const expected = turns.filter(turn => turn.sessionId === sessionId).length;
    expect(events.filter(event => event.type === "turn-started")).toHaveLength(expected);
    expect(events.filter(event => event.type === "turn-ended")).toHaveLength(expected);
    expect(events.filter(event => event.type === "step-started")).toHaveLength(events.filter(event => event.type === "step-ended").length);
    for (const event of events.filter(event => event.type === "error")) {
      expect(event.data.source).toBe("tool");
      expect(permittedFailures).toContain(event.data.toolCallId);
      failures.push(String(event.data.toolCallId));
    }
    const text = JSON.stringify(events);
    if (sessionId !== evidence.sessionId) expect(text).not.toContain("EVIDENCE_SESSION_PRIVATE_NOTE");
    if (sessionId !== validation.sessionId) expect(text).not.toContain("VALIDATION_SESSION_PRIVATE_NOTE");
  }
  expect(failures.sort()).toEqual([...permittedFailures].sort());
  expect(app.resources.listByProject(project.id).map(resource => ({ revision: resource.revision, access: resource.access })))
    .toEqual(Array.from({ length: 2 }, () => ({ revision: 2, access: { kind: "shared", nodeIds: [nodeId("synthesis")] } })));
  expect(app.mailbox.getHistory(project.id).every(message => message.recipient.kind === "main")).toBe(true);
  for (const node of app.nodes.getByProject(project.id)) {
    expect(projectNode(node.node.id, app.nodes.getEvents(node.node.id))).toEqual(node);
  }
  expect(projectRoadmap(project.id, app.roadmaps.getEvents(project.id), app.nodes.getByProject(project.id).map(node => node.node)))
    .toEqual(app.roadmaps.get(project.id));
});
