import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { projectSessionRecoveryMethod, projectCreateMethod } from "../../../rpc/index.js";
import { createProjectId, createSessionId, createStepId, createTurnId } from "../../../src/brand/ids.js";
import { call, host, seedRoadmap, workspace } from "./helpers.js";

describe("Kernel Host project session recovery", () => {
  it("reports Main and Node ownership without starting a Turn", async () => {
    const { ctx, client } = await host();
    const project = await call(client, projectCreateMethod, {
      name: "Recovery", goal: "Inspect history", workspaceRoot: await workspace(),
    });
    const { first, second } = seedRoadmap(ctx, project.projectId);
    const emptySessionId = createSessionId("empty-node-session");
    ctx.nodes.bindSession(first, emptySessionId);
    const initial = await call(client, projectSessionRecoveryMethod, { projectId: project.projectId });

    expect(initial.sessions).toEqual([
      { owner: { kind: "main" }, status: "available", sessionId: expect.any(String), lastEndedTurn: null },
      { owner: { kind: "node", nodeId: String(first) }, status: "available", sessionId: String(emptySessionId), lastEndedTurn: null },
      { owner: { kind: "node", nodeId: String(second) }, status: "unestablished" },
    ]);
  });

  it("returns the persisted terminal status and host interruption reason", async () => {
    const { ctx, client } = await host();
    const project = await call(client, projectCreateMethod, {
      name: "Interrupted", goal: "Inspect interruption", workspaceRoot: await workspace(),
    });
    const { first } = seedRoadmap(ctx, project.projectId);
    const sessionId = createSessionId("node-session");
    ctx.nodes.bindSession(first, sessionId);
    const turnId = createTurnId("interrupted-turn");
    const stepId = createStepId("interrupted-step");
    ctx.sessions.append({ type: "turn-started", sessionId, data: { turnId } });
    ctx.sessions.append({
      type: "error", sessionId,
      data: { turnId, stepId, source: "runtime", failure: {
        code: "interrupted", message: "Turn was interrupted because the Host stopped before it recorded completion.",
      } },
    });
    ctx.sessions.append({ type: "turn-ended", sessionId, data: { turnId, status: "failed" } });

    const recovery = await call(client, projectSessionRecoveryMethod, { projectId: project.projectId });
    const node = recovery.sessions.find(entry => entry.owner.kind === "node" && entry.owner.nodeId === String(first));
    expect(node).toMatchObject({
      owner: { kind: "node", nodeId: String(first) },
      status: "available",
      sessionId: String(sessionId),
      lastEndedTurn: { turnId: String(turnId), status: "failed", interruption: "host-stopped" },
    });
    expect(node && node.status === "available" ? node.lastEndedTurn?.startedAt : undefined).toEqual(expect.any(String));
  });

  it("derives context-compaction only from its interrupted compaction event", async () => {
    const { ctx, client } = await host();
    const project = await call(client, projectCreateMethod, {
      name: "Compaction", goal: "Inspect compaction interruption", workspaceRoot: await workspace(),
    });
    const { first } = seedRoadmap(ctx, project.projectId);
    const sessionId = createSessionId("compaction-session");
    ctx.nodes.bindSession(first, sessionId);
    const turnId = createTurnId("compaction-turn");
    const stepId = createStepId("compaction-step");
    ctx.sessions.append({ type: "turn-started", sessionId, data: { turnId } });
    ctx.sessions.append({
      type: "compaction-ended", sessionId,
      data: {
        turnId, compactionId: "compaction-1", status: "interrupted",
        failure: { code: "context-compaction-interrupted", message: "Compaction was interrupted." },
      },
    });
    ctx.sessions.append({
      type: "error", sessionId,
      data: { turnId, stepId, source: "runtime", failure: { code: "interrupted", message: "Turn was interrupted." } },
    });
    ctx.sessions.append({ type: "turn-ended", sessionId, data: { turnId, status: "failed" } });

    const recovery = await call(client, projectSessionRecoveryMethod, { projectId: project.projectId });
    const node = recovery.sessions.find(entry => entry.owner.kind === "node" && entry.owner.nodeId === String(first));
    expect(node).toMatchObject({ lastEndedTurn: { interruption: "context-compaction" } });
  });

  it("reports the interruption repaired during a persistent Host restart", async () => {
    const root = await mkdtemp(join(tmpdir(), "navo-project-session-recovery-"));
    const path = join(root, "navo.db");
    let restarted: Awaited<ReturnType<typeof host>> | undefined;
    try {
      const first = await host([], { path });
      const project = await call(first.client, projectCreateMethod, {
        name: "Restarted", goal: "Inspect restart recovery", workspaceRoot: await workspace(),
      });
      const mainSessionId = first.ctx.projects.get(createProjectId(project.projectId))!.mainSessionId;
      first.ctx.sessions.append({
        type: "turn-started", sessionId: mainSessionId, data: { turnId: createTurnId("restart-turn") },
      });
      await first.ctx.fiber.dispose();

      restarted = await host([], { path });
      const recovery = await call(restarted.client, projectSessionRecoveryMethod, { projectId: project.projectId });
      expect(recovery.sessions[0]).toMatchObject({
        owner: { kind: "main" },
        status: "available",
        lastEndedTurn: { status: "failed", interruption: "host-stopped" },
      });
      expect(restarted.adapter.requests).toHaveLength(0);
    } finally {
      if (restarted !== undefined) await restarted.ctx.fiber.dispose();
      await rm(root, { recursive: true, force: true });
    }
  });

  it("distinguishes a persisted session that cannot be read", async () => {
    const { ctx, client } = await host();
    const project = await call(client, projectCreateMethod, {
      name: "Unavailable", goal: "Inspect unreadable history", workspaceRoot: await workspace(),
    });
    const { first } = seedRoadmap(ctx, project.projectId);
    const sessionId = createSessionId("unavailable-session");
    ctx.nodes.bindSession(first, sessionId);
    (ctx.storage.recovery.unavailableSessionIds as Set<string>).add(String(sessionId));

    const recovery = await call(client, projectSessionRecoveryMethod, { projectId: project.projectId });
    const node = recovery.sessions.find(entry => entry.owner.kind === "node" && entry.owner.nodeId === String(first));
    expect(node).toEqual({
      owner: { kind: "node", nodeId: String(first) },
      status: "unavailable",
      sessionId: String(sessionId),
      reason: "not-readable",
    });
  });

  it("does not expose another Project's Node session", async () => {
    const { ctx, client } = await host();
    const firstProject = await call(client, projectCreateMethod, {
      name: "First", goal: "First goal", workspaceRoot: await workspace(),
    });
    const secondProject = await call(client, projectCreateMethod, {
      name: "Second", goal: "Second goal", workspaceRoot: await workspace(),
    });
    const firstRoadmap = seedRoadmap(ctx, firstProject.projectId);
    ctx.nodes.bindSession(firstRoadmap.first, createSessionId("first-node-session"));

    const recovery = await call(client, projectSessionRecoveryMethod, { projectId: secondProject.projectId });
    expect(recovery.sessions.some(entry => entry.owner.kind === "node" && entry.owner.nodeId === String(firstRoadmap.first))).toBe(false);
  });

  it("cancels before producing a recovery snapshot", async () => {
    const { client } = await host();
    const controller = new AbortController();
    const stream = client.stream(projectSessionRecoveryMethod, { projectId: "missing" }, { signal: controller.signal })
      [Symbol.asyncIterator]();
    controller.abort();
    await expect(stream.next()).rejects.toMatchObject({ code: "cancelled" });
  });
});
