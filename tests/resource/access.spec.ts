import {
  mkdtemp,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

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
  const root = await mkdtemp(join(tmpdir(), "navo-resource-access-"));
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
  const project = ctx.projects.create({ goal: "Access project" });
  const workspace = await ctx.projectWorkspaces.create(project.id, root);
  return { project, workspace };
}

function createInput(projectId: ProjectId, sourceNodeId: NodeId) {
  return {
    projectId,
    sourceNodeId,
    name: "Resource",
    description: "Shared findings",
    type: "text/markdown",
    entryRef: "report.md",
  };
}

describe("Resource access and content boundary", () => {
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

    for (const value of [
      { kind: "shared", nodeIds: [] },
      { kind: "shared", nodeIds: [source.node.id] },
      { kind: "shared", nodeIds: [nodeB.node.id, nodeB.node.id] },
    ] as const) {
      expect(() => ctx.resources.setAccess({
        projectId: project.id,
        resourceId: resource.id,
        expectedRevision: 4,
        access: value,
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

  it("filters visibility while keeping Main and source Node implicit", async () => {
    const ctx = await domain();
    const { project } = await projectFixture(ctx);
    const source = ctx.nodes.create({ projectId: project.id, objective: objective("source") });
    const nodeB = ctx.nodes.create({ projectId: project.id, objective: objective("B") });
    const nodeC = ctx.nodes.create({ projectId: project.id, objective: objective("C") });
    const resource = await ctx.resources.create(createInput(project.id, source.node.id));

    expect(ctx.resources.getVisible(project.id, resource.id, { kind: "main" })).toEqual(resource);
    expect(ctx.resources.getVisible(project.id, resource.id, {
      kind: "node", nodeId: source.node.id,
    })).toEqual(resource);
    expect(ctx.resources.getVisible(project.id, resource.id, {
      kind: "node", nodeId: nodeB.node.id,
    })).toBeUndefined();

    const shared = ctx.resources.setAccess({
      projectId: project.id,
      resourceId: resource.id,
      expectedRevision: 1,
      access: { kind: "shared", nodeIds: [nodeB.node.id] },
    });
    expect(ctx.resources.getVisible(project.id, resource.id, {
      kind: "node", nodeId: nodeB.node.id,
    })).toEqual(shared);
    expect(ctx.resources.listVisible(project.id, {
      kind: "node", nodeId: nodeC.node.id,
    })).toEqual([]);

    const projectShared = ctx.resources.setAccess({
      projectId: project.id,
      resourceId: resource.id,
      expectedRevision: 2,
      access: { kind: "project" },
    });
    expect(ctx.resources.listVisible(project.id, {
      kind: "node", nodeId: nodeC.node.id,
    })).toEqual([projectShared]);
  });

  it("resolves entries only inside the current Resource root", async () => {
    const ctx = await domain();
    const { project, workspace } = await projectFixture(ctx);
    const source = ctx.nodes.create({ projectId: project.id, objective: objective("source") });
    const safe = await ctx.resources.create(createInput(project.id, source.node.id));
    const safeRoot = join(workspace.assetsRoot, String(safe.id));
    await writeFile(join(safeRoot, "report.md"), "safe\n", "utf8");

    await expect(ctx.resources.resolveEntry(
      project.id,
      safe.id,
      { kind: "node", nodeId: source.node.id },
    )).resolves.toEqual({
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
});
