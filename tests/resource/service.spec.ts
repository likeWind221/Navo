import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
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

async function fixture(prefix = "navo-resource-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
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
  await ctx.plugin(ResourceService);
  return ctx;
}

async function projectFixture(ctx: Context, goal = "Resource project") {
  const root = await fixture();
  const project = ctx.projects.create({ goal });
  const workspace = await ctx.projectWorkspaces.create(project.id, root);
  return { project, workspace, root };
}

function createInput(projectId: ProjectId, sourceNodeId: NodeId) {
  return {
    projectId,
    sourceNodeId,
    name: "Experiment report",
    description: "Reusable experiment findings",
    type: "text/markdown",
    entryRef: "report.md",
  };
}

describe("Resource Service lifecycle and access", () => {
  it("creates a stable private Resource and prepares only its .navo asset root", async () => {
    const ctx = await domain();
    const { project, workspace, root } = await projectFixture(ctx);
    await writeFile(join(root, "user.txt"), "keep\n", "utf8");
    const node = ctx.nodes.create({ projectId: project.id, objective: objective("produce") });

    const resource = await ctx.resources.create(createInput(project.id, node.node.id));

    expect(resource).toMatchObject({
      projectId: project.id,
      sourceNodeId: node.node.id,
      name: "Experiment report",
      description: "Reusable experiment findings",
      type: "text/markdown",
      entryRef: "report.md",
      access: { kind: "private" },
      revision: 1,
    });
    expect(resource.createdAt).toBe(resource.updatedAt);
    expect(Object.isFrozen(resource)).toBe(true);
    expect(Object.isFrozen(resource.access)).toBe(true);
    expect((await stat(join(workspace.assetsRoot, String(resource.id)))).isDirectory()).toBe(true);
    expect(await readFile(join(root, "user.txt"), "utf8")).toBe("keep\n");
    expect(ctx.resources.get(project.id, resource.id)).toEqual(resource);
    expect(ctx.resources.listByProject(project.id)).toEqual([resource]);
    expect(ctx.resources.getEvents(project.id)).toHaveLength(1);
  });

  it("updates mutable metadata with optimistic revision and skips semantic no-ops", async () => {
    const ctx = await domain();
    const { project } = await projectFixture(ctx);
    const node = ctx.nodes.create({ projectId: project.id, objective: objective("produce") });
    const created = await ctx.resources.create(createInput(project.id, node.node.id));

    const updated = ctx.resources.update({
      projectId: project.id,
      resourceId: created.id,
      expectedRevision: 1,
      changes: {
        name: "Final report",
        description: "Final findings",
        entryRef: "final.md",
      },
    });
    expect(updated).toMatchObject({
      id: created.id,
      projectId: created.projectId,
      sourceNodeId: created.sourceNodeId,
      name: "Final report",
      description: "Final findings",
      type: created.type,
      entryRef: "final.md",
      access: { kind: "private" },
      revision: 2,
      createdAt: created.createdAt,
    });
    expect(updated.updatedAt >= created.updatedAt).toBe(true);

    const noOp = ctx.resources.update({
      projectId: project.id,
      resourceId: created.id,
      expectedRevision: 2,
      changes: { name: "Final report" },
    });
    expect(noOp).toBe(updated);
    expect(ctx.resources.getEvents(project.id)).toHaveLength(2);

    expect(() => ctx.resources.update({
      projectId: project.id,
      resourceId: created.id,
      expectedRevision: 1,
      changes: { name: "stale" },
    })).toThrow(expect.objectContaining({ code: "stale-revision" }));

    expect(() => ctx.resources.update({
      projectId: project.id,
      resourceId: created.id,
      expectedRevision: 2,
      changes: {},
    })).toThrow(expect.objectContaining({ code: "invalid-resource" }));

    expect(() => ctx.resources.update({
      projectId: project.id,
      resourceId: created.id,
      expectedRevision: 2,
      changes: { entryRef: "../escape.md" },
    })).toThrow(expect.objectContaining({ code: "invalid-resource" }));
  });

  it("represents access as exactly private, shared Nodes, or the whole Project", async () => {
    const ctx = await domain();
    const { project } = await projectFixture(ctx);
    const source = ctx.nodes.create({ projectId: project.id, objective: objective("source") });
    const nodeB = ctx.nodes.create({ projectId: project.id, objective: objective("B") });
    const nodeC = ctx.nodes.create({ projectId: project.id, objective: objective("C") });
    const control = ctx.nodes.create({
      projectId: project.id,
      kind: "control",
      purpose: "checkpoint",
      title: "review",
    });
    const otherProject = ctx.projects.create({ goal: "Other" });
    await ctx.projectWorkspaces.create(otherProject.id, await fixture());
    const otherNode = ctx.nodes.create({
      projectId: otherProject.id,
      objective: objective("other"),
    });
    const resource = await ctx.resources.create(createInput(project.id, source.node.id));

    const shared = ctx.resources.setAccess({
      projectId: project.id,
      resourceId: resource.id,
      expectedRevision: 1,
      access: { kind: "shared", nodeIds: [nodeC.node.id, nodeB.node.id] },
    });
    expect(shared.revision).toBe(2);
    expect(shared.access).toEqual({
      kind: "shared",
      nodeIds: [...[nodeB.node.id, nodeC.node.id]].sort(),
    });

    const projectShared = ctx.resources.setAccess({
      projectId: project.id,
      resourceId: resource.id,
      expectedRevision: 2,
      access: { kind: "project" },
    });
    expect(projectShared).toMatchObject({ revision: 3, access: { kind: "project" } });

    const privateAgain = ctx.resources.setAccess({
      projectId: project.id,
      resourceId: resource.id,
      expectedRevision: 3,
      access: { kind: "private" },
    });
    expect(privateAgain).toMatchObject({ revision: 4, access: { kind: "private" } });

    expect(ctx.resources.setAccess({
      projectId: project.id,
      resourceId: resource.id,
      expectedRevision: 4,
      access: { kind: "private" },
    })).toBe(privateAgain);
    expect(ctx.resources.getEvents(project.id)).toHaveLength(4);

    for (const access of [
      { kind: "shared", nodeIds: [] },
      { kind: "shared", nodeIds: [source.node.id] },
      { kind: "shared", nodeIds: [nodeB.node.id, nodeB.node.id] },
    ] as const) {
      expect(() => ctx.resources.setAccess({
        projectId: project.id,
        resourceId: resource.id,
        expectedRevision: 4,
        access,
      })).toThrow(expect.objectContaining({ code: "invalid-access" }));
    }

    for (const nodeId of [control.node.id, otherNode.node.id]) {
      expect(() => ctx.resources.setAccess({
        projectId: project.id,
        resourceId: resource.id,
        expectedRevision: 4,
        access: { kind: "shared", nodeIds: [nodeId] },
      })).toThrow(expect.objectContaining({ code: "invalid-access" }));
    }
  });

  it("filters Resource visibility without storing Main or source Node in the ACL", async () => {
    const ctx = await domain();
    const { project } = await projectFixture(ctx);
    const source = ctx.nodes.create({ projectId: project.id, objective: objective("source") });
    const nodeB = ctx.nodes.create({ projectId: project.id, objective: objective("B") });
    const nodeC = ctx.nodes.create({ projectId: project.id, objective: objective("C") });
    const resource = await ctx.resources.create(createInput(project.id, source.node.id));

    expect(ctx.resources.getVisible(project.id, resource.id, { kind: "main" })).toEqual(resource);
    expect(ctx.resources.getVisible(project.id, resource.id, {
      kind: "node",
      nodeId: source.node.id,
    })).toEqual(resource);
    expect(ctx.resources.getVisible(project.id, resource.id, {
      kind: "node",
      nodeId: nodeB.node.id,
    })).toBeUndefined();

    const shared = ctx.resources.setAccess({
      projectId: project.id,
      resourceId: resource.id,
      expectedRevision: 1,
      access: { kind: "shared", nodeIds: [nodeB.node.id] },
    });
    expect(ctx.resources.getVisible(project.id, resource.id, {
      kind: "node",
      nodeId: nodeB.node.id,
    })).toEqual(shared);
    expect(ctx.resources.getVisible(project.id, resource.id, {
      kind: "node",
      nodeId: nodeC.node.id,
    })).toBeUndefined();
    expect(ctx.resources.listVisible(project.id, {
      kind: "node",
      nodeId: nodeC.node.id,
    })).toEqual([]);

    const projectShared = ctx.resources.setAccess({
      projectId: project.id,
      resourceId: resource.id,
      expectedRevision: 2,
      access: { kind: "project" },
    });
    expect(ctx.resources.listVisible(project.id, {
      kind: "node",
      nodeId: nodeC.node.id,
    })).toEqual([projectShared]);
  });

  it("deletes only the Resource fact and preserves its physical content root", async () => {
    const ctx = await domain();
    const { project, workspace } = await projectFixture(ctx);
    const source = ctx.nodes.create({ projectId: project.id, objective: objective("source") });
    const resource = await ctx.resources.create(createInput(project.id, source.node.id));
    const resourceRoot = join(workspace.assetsRoot, String(resource.id));
    await writeFile(join(resourceRoot, "report.md"), "result\n", "utf8");

    ctx.resources.delete({
      projectId: project.id,
      resourceId: resource.id,
      expectedRevision: 1,
    });

    expect(ctx.resources.get(project.id, resource.id)).toBeUndefined();
    expect(ctx.resources.listByProject(project.id)).toEqual([]);
    expect(await readFile(join(resourceRoot, "report.md"), "utf8")).toBe("result\n");
    expect(ctx.resources.getEvents(project.id).at(-1)).toMatchObject({
      type: "resource-deleted",
      baseRevision: 1,
      revision: 2,
    });
    expect(() => ctx.resources.update({
      projectId: project.id,
      resourceId: resource.id,
      expectedRevision: 2,
      changes: { name: "cannot revive" },
    })).toThrow(expect.objectContaining({ code: "resource-unavailable" }));
  });

  it("resolves entries only inside the current Resource root", async () => {
    const ctx = await domain();
    const { project, workspace } = await projectFixture(ctx);
    const source = ctx.nodes.create({ projectId: project.id, objective: objective("source") });
    const safe = await ctx.resources.create(createInput(project.id, source.node.id));
    const safeRoot = join(workspace.assetsRoot, String(safe.id));
    await writeFile(join(safeRoot, "report.md"), "safe\n", "utf8");

    const resolved = await ctx.resources.resolveEntry(
      project.id,
      safe.id,
      { kind: "node", nodeId: source.node.id },
    );
    expect(resolved).toEqual({
      resourceId: safe.id,
      path: join(safeRoot, "report.md"),
    });

    const second = await ctx.resources.create({
      ...createInput(project.id, source.node.id),
      name: "Escaping entry",
      entryRef: "escape/secret.md",
    });
    const secondRoot = join(workspace.assetsRoot, String(second.id));
    await writeFile(join(safeRoot, "secret.md"), "secret\n", "utf8");
    await symlink(
      safeRoot,
      join(secondRoot, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );
    await expect(ctx.resources.resolveEntry(project.id, second.id))
      .rejects.toMatchObject({ code: "resource-content-unavailable" });

    const missing = await ctx.resources.create({
      ...createInput(project.id, source.node.id),
      name: "Missing entry",
      entryRef: "missing.md",
    });
    await expect(ctx.resources.resolveEntry(project.id, missing.id))
      .rejects.toMatchObject({ code: "resource-content-unavailable" });
  });

  it("allows reads from archived Projects but rejects lifecycle mutations", async () => {
    const ctx = await domain();
    const { project } = await projectFixture(ctx);
    const source = ctx.nodes.create({ projectId: project.id, objective: objective("source") });
    const resource = await ctx.resources.create(createInput(project.id, source.node.id));

    ctx.projects.archive(project.id, "pause");

    expect(ctx.resources.get(project.id, resource.id)).toEqual(resource);
    expect(ctx.resources.listByProject(project.id)).toEqual([resource]);
    expect(() => ctx.resources.update({
      projectId: project.id,
      resourceId: resource.id,
      expectedRevision: 1,
      changes: { name: "blocked" },
    })).toThrow(expect.objectContaining({ code: "project-unavailable" }));
    expect(() => ctx.resources.setAccess({
      projectId: project.id,
      resourceId: resource.id,
      expectedRevision: 1,
      access: { kind: "project" },
    })).toThrow(expect.objectContaining({ code: "project-unavailable" }));
    expect(() => ctx.resources.delete({
      projectId: project.id,
      resourceId: resource.id,
      expectedRevision: 1,
    })).toThrow(expect.objectContaining({ code: "project-unavailable" }));
  });

  it("mounts the Resource Service in the complete application", async () => {
    const root = await fixture();
    const app = await createApp({
      node: { session: { model: { provider: "mock", model: "test" } } },
    });
    contexts.push(app);
    const project = app.projects.create({ goal: "Mounted Resource Service" });
    await app.projectWorkspaces.create(project.id, root);
    const source = app.nodes.create({
      projectId: project.id,
      objective: objective("produce"),
    });

    const resource = await app.resources.create(createInput(project.id, source.node.id));
    expect(app.resources.get(project.id, resource.id)).toEqual(resource);
    expect(app.resourceStore.getState(resource.id)?.resource).toEqual(resource);
  });
});
