import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import type { NodeId, ProjectId } from "../../src/brand/ids.js";
import { NodeStore } from "../../src/node/store.js";
import { ProjectStore } from "../../src/project/store.js";
import { ResourceService } from "../../src/resource/service.js";
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
  const root = await mkdtemp(join(tmpdir(), "navo-resource-lifecycle-"));
  roots.push(root);
  return root;
}

async function domain(): Promise<Context> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(ProjectStore);
  await ctx.plugin(NodeStore);
  await ctx.plugin(ProjectWorkspaceStore);
  await ctx.plugin(ResourceService);
  return ctx;
}

async function projectFixture(ctx: Context) {
  const root = await fixture();
  const project = ctx.projects.create({ goal: "Resource project" });
  const workspace = await ctx.projectWorkspaces.create(project.id, root);
  await mkdir(join(root, "sources"));
  return { project, workspace, root };
}

async function publishNodeResource(
  ctx: Context,
  projectId: ProjectId,
  root: string,
  nodeId: NodeId,
  source = "sources/report.md",
) {
  await writeFile(join(root, ...source.split("/")), "result\n", "utf8");
  return ctx.resources.publish({
    projectId,
    owner: { kind: "node", nodeId },
    sourceRef: source,
    name: "Experiment report",
    description: "Reusable experiment findings",
    type: "text/markdown",
  });
}

describe("Resource Service lifecycle", () => {
  it("publishes a stable private Node-owned Resource by copying a Workspace file", async () => {
    const ctx = await domain();
    const { project, workspace, root } = await projectFixture(ctx);
    const node = ctx.nodes.create({ projectId: project.id, objective: objective("produce") });

    const resource = await publishNodeResource(ctx, project.id, root, node.node.id);

    expect(resource).toMatchObject({
      projectId: project.id,
      owner: { kind: "node", nodeId: node.node.id },
      name: "Experiment report",
      entryRef: "report.md",
      access: { kind: "private" },
      revision: 1,
    });
    const copied = join(workspace.assetsRoot, String(resource.id), "report.md");
    expect((await stat(copied)).isFile()).toBe(true);
    expect(await readFile(copied, "utf8")).toBe("result\n");
    expect(await readFile(join(root, "sources", "report.md"), "utf8")).toBe("result\n");
  });

  it("lets a Node owner update metadata with optimistic revision", async () => {
    const ctx = await domain();
    const { project, root } = await projectFixture(ctx);
    const owner = ctx.nodes.create({ projectId: project.id, objective: objective("owner") });
    const resource = await publishNodeResource(ctx, project.id, root, owner.node.id);

    const updated = ctx.resources.update({
      projectId: project.id,
      actor: { kind: "node", nodeId: owner.node.id },
      resourceId: resource.id,
      expectedRevision: 1,
      changes: {
        name: "Final report",
        description: "Final findings",
      },
    });
    expect(updated).toMatchObject({
      name: "Final report",
      description: "Final findings",
      entryRef: "report.md",
      revision: 2,
    });

    expect(() => ctx.resources.update({
      projectId: project.id,
      actor: { kind: "node", nodeId: owner.node.id },
      resourceId: resource.id,
      expectedRevision: 1,
      changes: { name: "stale" },
    })).toThrow(expect.objectContaining({ code: "stale-revision" }));
  });

  it("supports Main-owned Resources with the same owner CRUD rule", async () => {
    const ctx = await domain();
    const { project, root } = await projectFixture(ctx);
    await writeFile(join(root, "sources", "main.md"), "main result\n", "utf8");

    const resource = await ctx.resources.publish({
      projectId: project.id,
      owner: { kind: "main" },
      sourceRef: "sources/main.md",
      name: "Main synthesis",
      description: "Project-level synthesis",
      type: "text/markdown",
    });
    expect(resource.owner).toEqual({ kind: "main" });

    const updated = ctx.resources.update({
      projectId: project.id,
      actor: { kind: "main" },
      resourceId: resource.id,
      expectedRevision: 1,
      changes: { name: "Main synthesis v2" },
    });
    expect(updated.revision).toBe(2);

    ctx.resources.delete({
      projectId: project.id,
      actor: { kind: "main" },
      resourceId: resource.id,
      expectedRevision: 2,
    });
    expect(ctx.resources.get(project.id, resource.id)).toBeUndefined();
  });

  it("domain delete removes the active fact but preserves published content", async () => {
    const ctx = await domain();
    const { project, workspace, root } = await projectFixture(ctx);
    const owner = ctx.nodes.create({ projectId: project.id, objective: objective("owner") });
    const resource = await publishNodeResource(ctx, project.id, root, owner.node.id);
    const copied = join(workspace.assetsRoot, String(resource.id), "report.md");

    ctx.resources.delete({
      projectId: project.id,
      actor: { kind: "node", nodeId: owner.node.id },
      resourceId: resource.id,
      expectedRevision: 1,
    });

    expect(ctx.resources.get(project.id, resource.id)).toBeUndefined();
    expect(await readFile(copied, "utf8")).toBe("result\n");
  });

  it("rejects publishing from .navo and Workspace escape paths", async () => {
    const ctx = await domain();
    const { project, root } = await projectFixture(ctx);
    const owner = ctx.nodes.create({ projectId: project.id, objective: objective("owner") });
    await writeFile(join(root, ".navo", "nodes", "internal.txt"), "internal", "utf8");

    for (const sourceRef of [".navo/nodes/internal.txt", "../outside.txt"]) {
      await expect(ctx.resources.publish({
        projectId: project.id,
        owner: { kind: "node", nodeId: owner.node.id },
        sourceRef,
        name: "Invalid",
        description: "Invalid source",
        type: "text/plain",
      })).rejects.toMatchObject({ code: "invalid-resource" });
    }
  });

  it("allows reads from archived Projects but rejects owner mutations", async () => {
    const ctx = await domain();
    const { project, root } = await projectFixture(ctx);
    const owner = ctx.nodes.create({ projectId: project.id, objective: objective("owner") });
    const resource = await publishNodeResource(ctx, project.id, root, owner.node.id);
    ctx.projects.archive(project.id, "pause");

    expect(ctx.resources.get(project.id, resource.id)).toEqual(resource);
    expect(() => ctx.resources.update({
      projectId: project.id,
      actor: { kind: "node", nodeId: owner.node.id },
      resourceId: resource.id,
      expectedRevision: 1,
      changes: { name: "blocked" },
    })).toThrow(expect.objectContaining({ code: "project-unavailable" }));
  });

  it("mounts Resource publication in the complete application", async () => {
    const root = await fixture();
    await mkdir(join(root, "sources"));
    await writeFile(join(root, "sources", "app.md"), "app\n", "utf8");
    const app = await createApp({
      node: { session: { model: { provider: "mock", model: "test" } } },
    });
    contexts.push(app);
    const project = app.projects.create({ goal: "Mounted Resource Service" });
    await app.projectWorkspaces.create(project.id, root);

    const resource = await app.resources.publish({
      projectId: project.id,
      owner: { kind: "main" },
      sourceRef: "sources/app.md",
      name: "App resource",
      description: "Mounted through NavoApp",
      type: "text/markdown",
    });
    expect(app.resources.get(project.id, resource.id)).toEqual(resource);
  });
});
