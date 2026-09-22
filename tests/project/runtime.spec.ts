import { describe, expect, it } from "vitest";
import { modelResponse } from "../helpers/runtime.js";
import { createKit, createWorkNode, addRoadmap, flushUntil } from "./runtime/helpers.js";

describe("ProjectRuntime Human-controlled Node start", () => {
  it("starts an idle Roadmap Node only after an explicit Human call", async () => {
    const { ctx, adapter } = await createKit([
      modelResponse([{ type: "text", text: "done" }]),
    ]);
    const project = ctx.projects.create({ goal: "Ship the Project" });
    const node = createWorkNode(ctx, project.id, "Implement");
    addRoadmap(ctx, project.id, [node.node.id]);

    expect(ctx.nodes.get(node.node.id)?.status).toBe("idle");
    expect(ctx.projectRuntime.canStartNode(project.id, node.node.id)).toBe(true);
    expect(adapter.requests).toHaveLength(0);

    await expect(ctx.projectRuntime.startNode({
      projectId: project.id,
      nodeId: node.node.id,
      text: "Start this Node",
    })).resolves.toMatchObject({
      nodeId: node.node.id,
      turn: { status: "completed" },
    });

    expect(adapter.requests).toHaveLength(1);
    expect(ctx.nodes.get(node.node.id)?.status).toBe("idle");
    expect(ctx.projectRuntime.canStartNode(project.id, node.node.id)).toBe(false);
    expect(ctx.projectRuntime.canContinueNode(project.id, node.node.id)).toBe(true);
  });

  it("does not treat an idle Node outside the current Roadmap as executable", async () => {
    const { ctx, adapter } = await createKit([]);
    const project = ctx.projects.create({ goal: "Follow the current plan" });
    const detached = createWorkNode(ctx, project.id, "Detached");
    ctx.nodes.unlock(detached.node.id, "Independent before Roadmap");
    const planned = createWorkNode(ctx, project.id, "Planned");
    addRoadmap(ctx, project.id, [planned.node.id]);

    expect(ctx.nodes.get(detached.node.id)?.status).toBe("idle");
    expect(ctx.projectRuntime.canStartNode(project.id, detached.node.id)).toBe(false);
    expect(() => ctx.projectRuntime.startNode({
      projectId: project.id,
      nodeId: detached.node.id,
      text: "Run detached",
    })).toThrow(expect.objectContaining({
      code: "invalid-state",
      message: "Node is not part of the current Project Roadmap.",
    }));
    expect(adapter.requests).toHaveLength(0);
  });

  it("keeps legacy independent Nodes executable when the Project has no Roadmap", async () => {
    const { ctx } = await createKit([
      modelResponse([{ type: "text", text: "done" }]),
    ]);
    const project = ctx.projects.create({ goal: "Standalone work" });
    const node = createWorkNode(ctx, project.id, "Standalone");
    ctx.nodes.unlock(node.node.id, "Human selected standalone work");

    expect(ctx.projectRuntime.canStartNode(project.id, node.node.id)).toBe(true);
    await expect(ctx.projectRuntime.startNode({
      projectId: project.id,
      nodeId: node.node.id,
      text: "Run standalone",
    })).resolves.toMatchObject({ turn: { status: "completed" } });
  });

  it("rejects archived Projects, cross-Project Nodes, locked Nodes, and control Nodes", async () => {
    const { ctx, adapter } = await createKit([]);
    const first = ctx.projects.create({ goal: "First" });
    const second = ctx.projects.create({ goal: "Second" });
    const locked = createWorkNode(ctx, first.id, "Locked");
    const foreign = createWorkNode(ctx, second.id, "Foreign");
    const control = ctx.nodes.create({
      projectId: first.id,
      kind: "control",
      purpose: "start",
      title: "Start",
    });
    ctx.nodes.unlock(control.node.id, "Ready");

    expect(ctx.projectRuntime.canStartNode(first.id, locked.node.id)).toBe(false);
    expect(() => ctx.projectRuntime.startNode({
      projectId: first.id,
      nodeId: foreign.node.id,
      text: "Cross project",
    })).toThrow(expect.objectContaining({ code: "node-not-found" }));
    expect(() => ctx.projectRuntime.startNode({
      projectId: first.id,
      nodeId: control.node.id,
      text: "Run control",
    })).toThrow(expect.objectContaining({ code: "invalid-state" }));

    ctx.projects.archive(first.id, "Pause");
    expect(ctx.projectRuntime.canStartNode(first.id, control.node.id)).toBe(false);
    expect(() => ctx.projectRuntime.startNode({
      projectId: first.id,
      nodeId: locked.node.id,
      text: "Run archived",
    })).toThrow(expect.objectContaining({ code: "project-unavailable" }));
    expect(adapter.requests).toHaveLength(0);
  });

  it("rejects a second Human start before the first Turn can be queued implicitly", async () => {
    const { ctx, adapter } = await createKit([{ kind: "hang" }]);
    const project = ctx.projects.create({ goal: "No duplicate starts" });
    const node = createWorkNode(ctx, project.id, "Long work");
    addRoadmap(ctx, project.id, [node.node.id]);

    const first = ctx.projectRuntime.startNode({
      projectId: project.id,
      nodeId: node.node.id,
      text: "First Human start",
    });

    expect(ctx.projectRuntime.canStartNode(project.id, node.node.id)).toBe(false);
    expect(() => ctx.projectRuntime.startNode({
      projectId: project.id,
      nodeId: node.node.id,
      text: "Second Human start",
    })).toThrow(expect.objectContaining({
      code: "invalid-state",
      message: "Node already has a Human-started Turn in progress.",
    }));

    await flushUntil(() => adapter.requests.length === 1);
    expect(ctx.nodes.get(node.node.id)?.status).toBe("working");
    expect(ctx.nodeSessions.stop(node.node.id)).toBe(true);
    await expect(first).resolves.toMatchObject({ turn: { status: "cancelled" } });
    expect(ctx.nodes.get(node.node.id)?.status).toBe("idle");
  });
});
