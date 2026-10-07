import { describe, expect, it } from "vitest";

import { projectCreateMethod, projectFollowMethod, projectTurnMethod } from "../../../rpc/index.js";
import type { ProjectFollowV1 } from "../../../rpc/index.js";
import { createProjectId } from "../../../src/brand/ids.js";
import { call, failureOf, host, seedRoadmap, workspace } from "./helpers.js";

describe("Kernel Host project.follow.v1", () => {
  it("sends a baseline, then one full replacement per committed change of this Project only", async () => {
    const { ctx, client } = await host();
    const created = await call(client, projectCreateMethod, { name: "Watch", goal: "Goal", workspaceRoot: await workspace() });
    const other = await call(client, projectCreateMethod, { name: "Other", goal: "Goal", workspaceRoot: await workspace() });
    const controller = new AbortController();
    const frames = client.stream(projectFollowMethod, { projectId: created.projectId }, { signal: controller.signal })
      [Symbol.asyncIterator]();
    const next = async (): Promise<ProjectFollowV1> => (await frames.next()).value as ProjectFollowV1;

    const baseline = await next();
    expect(baseline).toMatchObject({ detail: { project: created, roadmap: null }, mailboxSequence: 0, resourceRevision: 0 });

    ctx.projects.archive(createProjectId(other.projectId), "Unrelated");
    ctx.projects.archive(createProjectId(created.projectId), "Paused");
    expect((await next()).detail.project).toMatchObject({ status: "archived", revision: 2 });

    ctx.projects.reopen(createProjectId(created.projectId), "Resume");
    const { first } = seedRoadmap(ctx, created.projectId);
    const planned = await next();
    expect(planned.detail.roadmap?.nodes.map(node => node.status)).toEqual(["idle", "locked"]);

    ctx.mailbox.postFromNode({ projectId: createProjectId(created.projectId), nodeId: first, body: "Found it" });
    expect((await next()).mailboxSequence).toBe(1);

    ctx.nodes.skip(first, { confirmedBy: "human", reason: "Skip", reviewedRevision: ctx.nodes.get(first)!.revision });
    const skipped = await next();
    expect(skipped.detail.roadmap?.nodes.map(node => node.status)).toEqual(["skipped", "idle"]);

    controller.abort();
    await expect(frames.next()).rejects.toMatchObject({ code: "cancelled" });
  });

  it("rejects an unknown Project before sending any frame", async () => {
    const { client } = await host();
    expect(await failureOf(client, projectFollowMethod, { projectId: "missing" }))
      .toMatchObject({ code: "project-not-found" });
  });
  it("reports a Human Turn becoming active and settling", async () => {
    const { client } = await host([{ kind: "hang", eventsBeforeHang: [] }]);
    const created = await call(client, projectCreateMethod, { name: "Turn", goal: "Goal", workspaceRoot: await workspace() });
    const follow = new AbortController();
    const frames = client.stream(projectFollowMethod, { projectId: created.projectId }, { signal: follow.signal })
      [Symbol.asyncIterator]();
    const next = async (): Promise<ProjectFollowV1> => (await frames.next()).value as ProjectFollowV1;
    expect((await next()).detail.main.turnActive).toBe(false);

    const turn = new AbortController();
    const running = client.stream(projectTurnMethod, {
      projectId: created.projectId, requestId: "main", text: "Plan", target: { kind: "main" },
    }, { signal: turn.signal })[Symbol.asyncIterator]();
    void running.next().catch(() => undefined);
    expect((await next()).detail.main.turnActive).toBe(true);
    turn.abort();
    expect((await next()).detail.main.turnActive).toBe(false);
    follow.abort();
    await frames.next().catch(() => undefined);
  });
});
