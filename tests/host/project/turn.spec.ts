import { describe, expect, it } from "vitest";

import type { AgentTurnV2Event } from "../../../rpc/index.js";
import {
  projectCreateMethod,
  projectGetMethod,
  projectNodeReviewMethod,
  projectTurnMethod,
} from "../../../rpc/index.js";
import { createProjectId } from "../../../src/brand/ids.js";
import type { ModelEvent } from "../../../src/llm/types.js";
import { call, failureOf, host, seedRoadmap, workspace } from "./helpers.js";

const reply: readonly ModelEvent[] = [
  { type: "content-started", contentIndex: 0, contentType: "text" },
  { type: "content-delta", contentIndex: 0, contentType: "text", delta: "ok" },
  { type: "content-completed", contentIndex: 0, contentType: "text" },
  { type: "finished", reason: { kind: "stop" } },
];
const hang = {
  kind: "hang" as const,
  eventsBeforeHang: [
    { type: "content-started", contentIndex: 0, contentType: "text" },
    { type: "content-delta", contentIndex: 0, contentType: "text", delta: "working" },
  ] satisfies ModelEvent[],
};

async function collect(stream: AsyncIterable<AgentTurnV2Event>): Promise<AgentTurnV2Event[]> {
  const events: AgentTurnV2Event[] = [];
  for await (const event of stream) events.push(event);
  return events;
}

async function project(client: Awaited<ReturnType<typeof host>>["client"]) {
  return call(client, projectCreateMethod, { name: "Run", goal: "Goal", workspaceRoot: await workspace() });
}

async function until(condition: () => boolean): Promise<void> {
  for (let index = 0; index < 200 && !condition(); index += 1) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  expect(condition()).toBe(true);
}

describe("Kernel Host project.turn.v1", () => {
  it("streams a Human-started Main Turn on the Project's Main Session", async () => {
    const { client } = await host([{ kind: "events", events: reply }]);
    const created = await project(client);
    const before = await call(client, projectGetMethod, { projectId: created.projectId });

    const events = await collect(client.stream(projectTurnMethod, {
      projectId: created.projectId, requestId: "main-1", text: "Plan the work", target: { kind: "main" },
    }));
    expect(events[0]).toMatchObject({ type: "turn-started", sessionId: before.main.sessionId, requestId: "main-1" });
    expect(events.at(-1)?.type).toBe("turn-completed");
    expect((await call(client, projectGetMethod, { projectId: created.projectId })).main.turnActive).toBe(false);
  });

  it("starts a Node first, then continues the same Node Session", async () => {
    const { ctx, client } = await host([{ kind: "events", events: reply }, { kind: "events", events: reply }]);
    const created = await project(client);
    const { first } = seedRoadmap(ctx, created.projectId);
    const target = { kind: "node" as const, nodeId: first };

    const opening = await collect(client.stream(projectTurnMethod, {
      projectId: created.projectId, requestId: "node-1", text: "Start", target,
    }));
    const bound = ctx.nodes.get(first)?.sessionId;
    expect(bound).toBeDefined();
    expect(opening[0]).toMatchObject({ type: "turn-started", sessionId: bound });

    const next = await collect(client.stream(projectTurnMethod, {
      projectId: created.projectId, requestId: "node-2", text: "Continue", target,
    }));
    expect(next[0]).toMatchObject({ sessionId: bound, requestId: "node-2" });
    expect(next.at(-1)?.type).toBe("turn-completed");
    const node = (await call(client, projectGetMethod, { projectId: created.projectId })).roadmap?.nodes[0];
    expect(node).toMatchObject({ status: "idle", hasSession: true, turnActive: false });
  });

  it("cancels only the target Turn and rejects a concurrent Turn on the same Node", async () => {
    const { ctx, client } = await host([hang]);
    const created = await project(client);
    const { first } = seedRoadmap(ctx, created.projectId);
    const controller = new AbortController();
    const target = { kind: "node" as const, nodeId: first };
    const iterator = client.stream(projectTurnMethod, {
      projectId: created.projectId, requestId: "long", text: "Work", target,
    }, { signal: controller.signal })[Symbol.asyncIterator]();
    expect((await iterator.next()).value).toMatchObject({ type: "turn-started" });
    await until(() => ctx.projectRuntime.isNodeActive(first));

    const working = await call(client, projectGetMethod, { projectId: created.projectId });
    expect(working.roadmap?.nodes[0]).toMatchObject({
      status: "working", turnActive: true, actions: { run: false, complete: false, skip: false },
    });
    expect(await failureOf(client, projectTurnMethod, {
      projectId: created.projectId, requestId: "again", text: "Again", target,
    })).toMatchObject({ code: "turn-active" });

    controller.abort();
    await iterator.return?.(undefined);
    await until(() => !ctx.projectRuntime.isNodeActive(first));
    expect(ctx.nodes.get(first)?.status).toBe("idle");
  });

  it("rejects Turns for archived Projects, unknown Nodes and locked Nodes", async () => {
    const { ctx, client } = await host();
    const created = await project(client);
    const { second } = seedRoadmap(ctx, created.projectId);
    const turn = (target: { kind: "main" } | { kind: "node"; nodeId: string }) =>
      failureOf(client, projectTurnMethod, { projectId: created.projectId, requestId: "r", text: "Go", target });

    expect(await turn({ kind: "node", nodeId: "missing" })).toMatchObject({ code: "node-not-found" });
    expect(await turn({ kind: "node", nodeId: second })).toMatchObject({ code: "invalid-state" });
    ctx.projects.archive(createProjectId(created.projectId), "Paused");
    expect(await turn({ kind: "main" })).toMatchObject({ code: "project-unavailable" });
  });
});

describe("Kernel Host project.node.review.v1", () => {
  it("confirms completion against the reviewed revision and unlocks the successor", async () => {
    const { ctx, client } = await host();
    const created = await project(client);
    const { first, second } = seedRoadmap(ctx, created.projectId);
    const revision = ctx.nodes.get(first)!.revision;
    const review = { projectId: created.projectId, nodeId: first, action: "complete" as const, reason: "Looks right" };

    expect(await failureOf(client, projectNodeReviewMethod, { ...review, reviewedRevision: revision + 5 }))
      .toMatchObject({ code: "revision-conflict" });
    const completed = await call(client, projectNodeReviewMethod, { ...review, reviewedRevision: revision });
    expect(completed).toMatchObject({
      nodeId: first, status: "completing",
      confirmation: { confirmedBy: "human", reason: "Looks right", reviewedRevision: revision },
      actions: { run: false, complete: false, skip: false },
    });
    const detail = await call(client, projectGetMethod, { projectId: created.projectId });
    expect(detail.roadmap?.nodes.find(node => node.nodeId === second)?.status).toBe("idle");
  });

  it("skips a locked Node and refuses to complete it", async () => {
    const { ctx, client } = await host();
    const created = await project(client);
    const { second } = seedRoadmap(ctx, created.projectId);
    const reviewedRevision = ctx.nodes.get(second)!.revision;
    const review = { projectId: created.projectId, nodeId: second, reason: "Not needed", reviewedRevision };

    expect(await failureOf(client, projectNodeReviewMethod, { ...review, action: "complete" }))
      .toMatchObject({ code: "invalid-state" });
    expect(await call(client, projectNodeReviewMethod, { ...review, action: "skip" }))
      .toMatchObject({ status: "skipped", confirmation: { confirmedBy: "human" } });
  });
});
