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

describe("Resource ownership, access and content boundary", () => {
  it("keeps owner CRUD separate from Main-controlled read distribution", async () => {
    const ctx = await domain();
    const root = await fixture();
    const project = ctx.projects.create({ goal: "Access project" });
    await ctx.projectWorkspaces.create(project.id, root);
    await writeFile(join(root, "report.md"), "report\n", "utf8");
    const owner = ctx.nodes.create({ projectId: project.id, objective: objective("owner") });
    const reader = ctx.nodes.create({ projectId: project.id, objective: objective("reader") });
    const resource = await ctx.resources.publish({
      projectId: project.id,
      owner: { kind: "node", nodeId: owner.node.id },
      sourceRef: "report.md",
      name: "Report",
      description: "Owner report",
      type: "text/markdown",
    });

    expect(ctx.resources.getVisible(project.id, resource.id, {
      kind: "node", nodeId: reader.node.id,
    })).toBeUndefined();

    expect(() => ctx.resources.setAccess({
      projectId: project.id,
      actor: { kind: "node", nodeId: owner.node.id },
      resourceId: resource.id,
      expectedRevision: 1,
      access: { kind: "shared", nodeIds: [reader.node.id] },
    })).toThrow(expect.objectContaining({ code: "invalid-access" }));

    const shared = ctx.resources.setAccess({
      projectId: project.id,
      actor: { kind: "main" },
      resourceId: resource.id,
      expectedRevision: 1,
      access: { kind: "shared", nodeIds: [reader.node.id] },
    });
    expect(ctx.resources.getVisible(project.id, resource.id, {
      kind: "node", nodeId: reader.node.id,
    })).toEqual(shared);

    expect(() => ctx.resources.update({
      projectId: project.id,
      actor: { kind: "node", nodeId: reader.node.id },
      resourceId: resource.id,
      expectedRevision: 2,
      changes: { name: "Reader edit" },
    })).toThrow(expect.objectContaining({ code: "resource-not-owned" }));

    expect(() => ctx.resources.delete({
      projectId: project.id,
      actor: { kind: "main" },
      resourceId: resource.id,
      expectedRevision: 2,
    })).toThrow(expect.objectContaining({ code: "resource-not-owned" }));
  });

  it("supports private, shared and project access for Main-owned Resources", async () => {
    const ctx = await domain();
    const root = await fixture();
    const project = ctx.projects.create({ goal: "Main assets" });
    await ctx.projectWorkspaces.create(project.id, root);
    await writeFile(join(root, "main.md"), "main\n", "utf8");
    const nodeA = ctx.nodes.create({ projectId: project.id, objective: objective("A") });
    const nodeB = ctx.nodes.create({ projectId: project.id, objective: objective("B") });

    const resource = await ctx.resources.publish({
      projectId: project.id,
      owner: { kind: "main" },
      sourceRef: "main.md",
      name: "Main",
      description: "Main-owned",
      type: "text/markdown",
    });
    expect(ctx.resources.getVisible(project.id, resource.id, {
      kind: "node", nodeId: nodeA.node.id,
    })).toBeUndefined();

    const shared = ctx.resources.setAccess({
      projectId: project.id,
      actor: { kind: "main" },
      resourceId: resource.id,
      expectedRevision: 1,
      access: { kind: "shared", nodeIds: [nodeA.node.id] },
    });
    expect(ctx.resources.getVisible(project.id, resource.id, {
      kind: "node", nodeId: nodeA.node.id,
    })).toEqual(shared);
    expect(ctx.resources.getVisible(project.id, resource.id, {
      kind: "node", nodeId: nodeB.node.id,
    })).toBeUndefined();

    const projectWide = ctx.resources.setAccess({
      projectId: project.id,
      actor: { kind: "main" },
      resourceId: resource.id,
      expectedRevision: 2,
      access: { kind: "project" },
    });
    expect(ctx.resources.getVisible(project.id, resource.id, {
      kind: "node", nodeId: nodeB.node.id,
    })).toEqual(projectWide);
  });

  it("rejects invalid shared membership and implicit Node owner duplication", async () => {
    const ctx = await domain();
    const root = await fixture();
    const project = ctx.projects.create({ goal: "Membership" });
    await ctx.projectWorkspaces.create(project.id, root);
    await writeFile(join(root, "report.md"), "report\n", "utf8");
    const owner = ctx.nodes.create({ projectId: project.id, objective: objective("owner") });
    const reader = ctx.nodes.create({ projectId: project.id, objective: objective("reader") });
    const control = ctx.nodes.create({
      projectId: project.id,
      kind: "control",
      purpose: "checkpoint",
      title: "review",
    });
    const resource = await ctx.resources.publish({
      projectId: project.id,
      owner: { kind: "node", nodeId: owner.node.id },
      sourceRef: "report.md",
      name: "Report",
      description: "Membership",
      type: "text/markdown",
    });

    for (const access of [
      { kind: "shared", nodeIds: [] },
      { kind: "shared", nodeIds: [owner.node.id] },
      { kind: "shared", nodeIds: [reader.node.id, reader.node.id] },
      { kind: "shared", nodeIds: [control.node.id] },
    ] as const) {
      expect(() => ctx.resources.setAccess({
        projectId: project.id,
        actor: { kind: "main" },
        resourceId: resource.id,
        expectedRevision: 1,
        access,
      })).toThrow(expect.objectContaining({ code: "invalid-access" }));
    }
  });

  it("rejects an entry symlink that escapes into another Resource root", async () => {
    const ctx = await domain();
    const root = await fixture();
    const project = ctx.projects.create({ goal: "Content boundary" });
    const workspace = await ctx.projectWorkspaces.create(project.id, root);
    await writeFile(join(root, "first.md"), "first\n", "utf8");
    await writeFile(join(root, "second.md"), "second\n", "utf8");

    const first = await ctx.resources.publish({
      projectId: project.id,
      owner: { kind: "main" },
      sourceRef: "first.md",
      name: "First",
      description: "First",
      type: "text/markdown",
    });
    const second = await ctx.resources.publish({
      projectId: project.id,
      owner: { kind: "main" },
      sourceRef: "second.md",
      name: "Second",
      description: "Second",
      type: "text/markdown",
    });

    const firstEntry = join(workspace.assetsRoot, String(first.id), "first.md");
    const secondRoot = join(workspace.assetsRoot, String(second.id));
    await rm(firstEntry);
    await symlink(
      secondRoot,
      firstEntry,
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(ctx.resources.resolveEntry(project.id, first.id, { kind: "main" }))
      .rejects.toMatchObject({ code: "resource-content-unavailable" });
  });
});
