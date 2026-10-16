import { describe, expect, it } from "vitest";

import {
  projectAutoRunGetMethod,
  projectAutoRunPauseMethod,
  projectAutoRunStartMethod,
} from "../../rpc/project.js";
import { call, failureOf, flushUntil, host, seedRoadmap, workspace } from "./project/helpers.js";

describe("Kernel Host AutoRun methods", () => {
  it("starts AutoRun without waiting for the full execution loop", async () => {
    const { ctx, client, adapter } = await host([{ kind: "hang" }]);
    const created = await call(client, (await import("../../rpc/project.js")).projectCreateMethod, {
      name: "AutoRun", goal: "Run automatically", workspaceRoot: await workspace(),
    });
    const { first } = seedRoadmap(ctx, created.projectId);

    const started = await call(client, projectAutoRunStartMethod, { projectId: created.projectId });
    expect(started).toMatchObject({
      projectId: created.projectId,
      status: "running",
      nodeTurns: 0,
      mainTurns: 0,
      currentTarget: { kind: "node", nodeId: first },
      reason: null,
    });
    expect(adapter.requests).toHaveLength(1);

    const current = await call(client, projectAutoRunGetMethod, { projectId: created.projectId });
    expect(current).toMatchObject({
      status: "running",
      currentTarget: { kind: "node", nodeId: first },
    });

    expect(await call(client, projectAutoRunPauseMethod, { projectId: created.projectId }))
      .toMatchObject({ status: "running", currentTarget: { kind: "node", nodeId: first }, reason: null });

    expect(ctx.projectRuntime.stopNode(created.projectId, first)).toBe(true);
    await flushUntil(() => ctx.autoRun.get(created.projectId)?.status === "paused");

    expect(await call(client, projectAutoRunGetMethod, { projectId: created.projectId }))
      .toMatchObject({ status: "paused", reason: "turn-cancelled" });
  });

  it("returns a completed snapshot for a Roadmap with no Nodes", async () => {
    const { ctx, client } = await host();
    const created = await call(client, (await import("../../rpc/project.js")).projectCreateMethod, {
      name: "Empty", goal: "Nothing to run", workspaceRoot: await workspace(),
    });
    ctx.roadmaps.create({
      definition: { projectId: (await import("../../src/brand/ids.js")).createProjectId(created.projectId), nodes: [], edges: [] },
      reason: "Approved",
    });

    const started = await call(client, projectAutoRunStartMethod, { projectId: created.projectId });
    expect(started).toMatchObject({
      projectId: created.projectId,
      status: "completed",
      currentTarget: null,
      reason: "roadmap-complete",
    });
  });

  it("maps AutoRun control errors to stable RPC failures", async () => {
    const { ctx, client } = await host();
    const created = await call(client, (await import("../../rpc/project.js")).projectCreateMethod, {
      name: "Errors", goal: "Control errors", workspaceRoot: await workspace(),
    });

    expect(await failureOf(client, projectAutoRunPauseMethod, { projectId: created.projectId }))
      .toMatchObject({ code: "auto-run-not-found" });
    expect(await failureOf(client, projectAutoRunStartMethod, { projectId: created.projectId }))
      .toMatchObject({ code: "auto-run-unavailable" });
  });
});
