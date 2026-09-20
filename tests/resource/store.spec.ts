import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import {
  createProjectId,
  createResourceId,
} from "../../src/brand/ids.js";
import type { ProjectId } from "../../src/brand/ids.js";
import { NodeStore } from "../../src/node/store.js";
import { ProjectStore } from "../../src/project/store.js";
import { ResourceStore } from "../../src/resource/store.js";
import { ProjectWorkspaceStore } from "../../src/workspace/store.js";

const contexts: Context[] = [];
const roots: string[] = [];

const objective = (title: string) => ({
  title,
  description: `Do ${title}`,
  acceptanceCriteria: [`Finish ${title}`],
});

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "navo-resource-"));
  roots.push(root);
  return root;
}

async function domain(): Promise<Context> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(ProjectStore);
  await ctx.plugin(NodeStore);
  await ctx.plugin(ProjectWorkspaceStore);
  await ctx.plugin(ResourceStore);
  return ctx;
}

async function bind(ctx: Context, projectId: ProjectId, root = await fixture()): Promise<string> {
  await ctx.projectWorkspaces.create(projectId, root);
  return root;
}

async function makeFile(
  ctx: Context,
  projectId: ProjectId,
  ref: string,
  content = "resource\n",
): Promise<void> {
  const workspace = await ctx.projectWorkspaces.get(projectId);
  if (workspace === undefined) throw new Error("Project Workspace is not bound.");
  const target = await ctx.projectWorkspaces.resolve(projectId, ref);
  await writeFile(target.path, content, "utf8");
  expect(workspace.projectId).toBe(projectId);
}

describe("Project Resource Registry", () => {
  it("registers stable metadata and lists resources in Project order", async () => {
    const ctx = await domain();
    const project = ctx.projects.create({ goal: "Build reusable findings" });
    await bind(ctx, project.id);
    const node = ctx.nodes.create({ projectId: project.id, objective: objective("survey A2A") });
    await makeFile(ctx, project.id, "assets/a2a.md");

    const first = await ctx.resources.create({
      projectId: project.id,
      sourceNodeId: node.node.id,
      title: "A2A survey",
      description: "Architecture findings for later comparison",
      type: "text/markdown",
      ref: "assets/a2a.md",
    });
    await makeFile(ctx, project.id, "assets/evidence.json", "{}");
    const second = await ctx.resources.create({
      projectId: project.id,
      sourceNodeId: node.node.id,
      title: "Evidence index",
      description: "Structured source index",
      type: "application/json",
      ref: "assets/evidence.json",
    });

    expect(first.id).not.toBe(second.id);
    expect(first).toMatchObject({
      projectId: project.id,
      sourceNodeId: node.node.id,
      sequence: 1,
      title: "A2A survey",
      ref: "assets/a2a.md",
    });
    expect(ctx.resources.get(project.id, first.id)).toEqual(first);
    expect(ctx.resources.listByProject(project.id)).toEqual([first, second]);
    expect(Object.isFrozen(first)).toBe(true);
    expect(Object.isFrozen(ctx.resources.getEvents(project.id)[0]?.data)).toBe(true);
  });

  it("rejects cross-Project, control-Node, archived-Project, missing-target, and invalid metadata registrations", async () => {
    const ctx = await domain();
    const first = ctx.projects.create({ goal: "First" });
    const second = ctx.projects.create({ goal: "Second" });
    await bind(ctx, first.id);
    await bind(ctx, second.id);
    const firstNode = ctx.nodes.create({ projectId: first.id, objective: objective("first") });
    const secondNode = ctx.nodes.create({ projectId: second.id, objective: objective("second") });
    const control = ctx.nodes.create({
      projectId: first.id,
      kind: "control",
      purpose: "checkpoint",
      title: "Review",
    });

    await expect(ctx.resources.create({
      projectId: first.id,
      sourceNodeId: secondNode.node.id,
      title: "Cross",
      description: "Cross project",
      type: "text/plain",
      ref: "assets/cross.txt",
    })).rejects.toMatchObject({ code: "node-unavailable" });

    await expect(ctx.resources.create({
      projectId: first.id,
      sourceNodeId: control.node.id,
      title: "Control",
      description: "Control node",
      type: "text/plain",
      ref: "assets/control.txt",
    })).rejects.toMatchObject({ code: "node-unavailable" });

    await expect(ctx.resources.create({
      projectId: first.id,
      sourceNodeId: firstNode.node.id,
      title: "Missing",
      description: "Not written yet",
      type: "text/plain",
      ref: "assets/missing.txt",
    })).rejects.toMatchObject({ code: "resource-target-missing" });

    await expect(ctx.resources.create({
      projectId: first.id,
      sourceNodeId: firstNode.node.id,
      title: " ",
      description: "Invalid",
      type: "text/plain",
      ref: "assets/missing.txt",
    })).rejects.toMatchObject({ code: "invalid-resource" });

    ctx.projects.archive(first.id, "Pause");
    await expect(ctx.resources.create({
      projectId: first.id,
      sourceNodeId: firstNode.node.id,
      title: "Archived",
      description: "Cannot add",
      type: "text/plain",
      ref: "assets/missing.txt",
    })).rejects.toMatchObject({ code: "project-unavailable" });
    expect(ctx.resources.listByProject(first.id)).toEqual([]);
  });

  it("rejects cross-Project Resource lookup even when the caller knows the id", async () => {
    const ctx = await domain();
    const first = ctx.projects.create({ goal: "First" });
    const second = ctx.projects.create({ goal: "Second" });
    await bind(ctx, first.id);
    await bind(ctx, second.id);
    const node = ctx.nodes.create({ projectId: second.id, objective: objective("produce") });
    await makeFile(ctx, second.id, "assets/result.md");
    const resource = await ctx.resources.create({
      projectId: second.id,
      sourceNodeId: node.node.id,
      title: "Result",
      description: "Second Project result",
      type: "text/markdown",
      ref: "assets/result.md",
    });

    expect(() => ctx.resources.get(first.id, resource.id))
      .toThrow(expect.objectContaining({ code: "resource-unavailable" }));
    expect(ctx.resources.listByProject(first.id)).toEqual([]);
  });

  it("restores an immutable history atomically and continues registration sequence", async () => {
    const source = await domain();
    const project = source.projects.create({ goal: "Replay resources" });
    const root = await bind(source, project.id);
    const node = source.nodes.create({ projectId: project.id, objective: objective("produce") });
    await makeFile(source, project.id, "assets/report.md");
    const first = await source.resources.create({
      projectId: project.id,
      sourceNodeId: node.node.id,
      title: "Report",
      description: "Replayable report metadata",
      type: "text/markdown",
      ref: "assets/report.md",
    });

    const projectHistory = JSON.parse(JSON.stringify(source.projects.getEvents(project.id)));
    const nodeHistory = JSON.parse(JSON.stringify(source.nodes.getEvents(node.node.id)));
    const resourceHistory = JSON.parse(JSON.stringify(source.resources.getEvents(project.id)));

    const target = await domain();
    target.projects.restore(project.id, projectHistory);
    target.nodes.restore(node.node.id, nodeHistory);
    await target.projectWorkspaces.create(project.id, root);
    const restored = await target.resources.restore(project.id, resourceHistory);
    resourceHistory[0].data.title = "mutated outside";
    resourceHistory.push(resourceHistory[0]);

    expect(restored).toEqual([first]);
    expect(restored[0]?.title).toBe("Report");
    expect(Object.isFrozen(restored)).toBe(true);
    expect(Object.isFrozen(target.resources.getEvents(project.id))).toBe(true);

    await makeFile(target, project.id, "assets/next.md");
    const next = await target.resources.create({
      projectId: project.id,
      sourceNodeId: node.node.id,
      title: "Next",
      description: "Next registration",
      type: "text/markdown",
      ref: "assets/next.md",
    });
    expect(next.sequence).toBe(2);
  });

  it("rejects malformed replay and duplicate ids without partial commit", async () => {
    const source = await domain();
    const project = source.projects.create({ goal: "Validate replay" });
    const root = await bind(source, project.id);
    const node = source.nodes.create({ projectId: project.id, objective: objective("produce") });
    await makeFile(source, project.id, "assets/report.md");
    await source.resources.create({
      projectId: project.id,
      sourceNodeId: node.node.id,
      title: "Report",
      description: "Replayable report",
      type: "text/markdown",
      ref: "assets/report.md",
    });

    const projectHistory = JSON.parse(JSON.stringify(source.projects.getEvents(project.id)));
    const nodeHistory = JSON.parse(JSON.stringify(source.nodes.getEvents(node.node.id)));
    const event = JSON.parse(JSON.stringify(source.resources.getEvents(project.id)[0]));

    const target = await domain();
    target.projects.restore(project.id, projectHistory);
    target.nodes.restore(node.node.id, nodeHistory);
    await target.projectWorkspaces.create(project.id, root);

    await expect(target.resources.restore(project.id, [{ ...event, sequence: 2 }]))
      .rejects.toMatchObject({ code: "invalid-history" });
    expect(target.resources.listByProject(project.id)).toEqual([]);

    const duplicate = [{ ...event }, { ...event, sequence: 2, id: "other-event" }];
    await expect(target.resources.restore(project.id, duplicate))
      .rejects.toMatchObject({ code: "resource-already-exists" });
    expect(target.resources.listByProject(project.id)).toEqual([]);

    await expect(target.resources.restore(createProjectId("missing"), []))
      .rejects.toMatchObject({ code: "project-unavailable" });
    expect(target.resources.getEvents(project.id)).toEqual([]);
  });

  it("allows replay when content disappeared but still revalidates Workspace containment", async () => {
    const source = await domain();
    const project = source.projects.create({ goal: "Durable metadata" });
    const root = await bind(source, project.id);
    const node = source.nodes.create({ projectId: project.id, objective: objective("produce") });
    await makeFile(source, project.id, "assets/report.md");
    const resource = await source.resources.create({
      projectId: project.id,
      sourceNodeId: node.node.id,
      title: "Report",
      description: "May outlive file availability",
      type: "text/markdown",
      ref: "assets/report.md",
    });

    await rm((await source.projectWorkspaces.resolve(project.id, resource.ref)).path);

    const projectHistory = JSON.parse(JSON.stringify(source.projects.getEvents(project.id)));
    const nodeHistory = JSON.parse(JSON.stringify(source.nodes.getEvents(node.node.id)));
    const resourceHistory = JSON.parse(JSON.stringify(source.resources.getEvents(project.id)));

    const target = await domain();
    target.projects.restore(project.id, projectHistory);
    target.nodes.restore(node.node.id, nodeHistory);
    await target.projectWorkspaces.create(project.id, root);
    expect(await target.resources.restore(project.id, resourceHistory))
      .toMatchObject([{ id: resource.id, ref: resource.ref }]);
  });

  it("is mounted in NavoApp and uses an explicitly bound Project Workspace", async () => {
    const root = await fixture();
    const app = await createApp({
      node: { session: { model: { provider: "mock", model: "test" } } },
    });
    contexts.push(app);
    const project = app.projects.create({ goal: "Mounted registry" });
    await app.projectWorkspaces.create(project.id, root);
    const node = app.nodes.create({ projectId: project.id, objective: objective("produce") });
    await makeFile(app, project.id, "assets/app.md");
    const resource = await app.resources.create({
      projectId: project.id,
      sourceNodeId: node.node.id,
      title: "App resource",
      description: "Mounted through NavoApp",
      type: "text/markdown",
      ref: "assets/app.md",
    });
    expect(app.resources.get(project.id, resource.id)).toEqual(resource);
    expect(() => app.resources.get(project.id, createResourceId("missing"))).not.toThrow();
  });
});
