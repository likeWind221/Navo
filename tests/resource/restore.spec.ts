import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import type { ProjectId } from "../../src/brand/ids.js";
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

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "navo-resource-restore-"));
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

async function restoreDomain(
  source: Context,
  projectId: ProjectId,
  nodeIds: readonly ReturnType<typeof source.nodes.create>[],
  root: string,
): Promise<Context> {
  const target = await domain();
  target.projects.restore(
    projectId,
    JSON.parse(JSON.stringify(source.projects.getEvents(projectId))),
  );
  for (const node of nodeIds) {
    target.nodes.restore(
      node.node.id,
      JSON.parse(JSON.stringify(source.nodes.getEvents(node.node.id))),
    );
  }
  await target.projectWorkspaces.create(projectId, root);
  return target;
}

describe("Resource history replay", () => {
  it("replays create, metadata, access, and delete facts and continues revisions", async () => {
    const source = await domain();
    const root = await fixture();
    const project = source.projects.create({ goal: "Replay Resource lifecycle" });
    await source.projectWorkspaces.create(project.id, root);
    const nodeA = source.nodes.create({ projectId: project.id, objective: objective("A") });
    const nodeB = source.nodes.create({ projectId: project.id, objective: objective("B") });

    const first = await source.resources.create({
      projectId: project.id,
      sourceNodeId: nodeA.node.id,
      name: "First",
      description: "First resource",
      type: "text/markdown",
      entryRef: "report.md",
    });
    const updated = source.resources.update({
      projectId: project.id,
      resourceId: first.id,
      expectedRevision: 1,
      changes: { name: "First updated" },
    });
    const shared = source.resources.setAccess({
      projectId: project.id,
      resourceId: first.id,
      expectedRevision: 2,
      access: { kind: "shared", nodeIds: [nodeB.node.id] },
    });

    const second = await source.resources.create({
      projectId: project.id,
      sourceNodeId: nodeA.node.id,
      name: "Second",
      description: "Delete me",
      type: "application/json",
      entryRef: "data.json",
    });
    source.resources.delete({
      projectId: project.id,
      resourceId: second.id,
      expectedRevision: 1,
    });

    const history = JSON.parse(JSON.stringify(source.resources.getEvents(project.id)));
    const target = await restoreDomain(source, project.id, [nodeA, nodeB], root);
    const restored = await target.resources.restore(project.id, history);

    expect(restored).toEqual([shared]);
    expect(restored[0]).toMatchObject({
      id: first.id,
      name: "First updated",
      revision: 3,
      access: { kind: "shared", nodeIds: [nodeB.node.id] },
      createdAt: first.createdAt,
      updatedAt: shared.updatedAt,
    });
    expect(target.resources.get(project.id, second.id)).toBeUndefined();
    expect(target.resourceStore.getState(second.id)).toMatchObject({
      status: "deleted",
      resource: { revision: 2 },
    });
    expect(Object.isFrozen(target.resources.getEvents(project.id))).toBe(true);

    const continued = target.resources.update({
      projectId: project.id,
      resourceId: first.id,
      expectedRevision: 3,
      changes: { description: "continued after replay" },
    });
    expect(continued.revision).toBe(4);
    expect(target.resources.getEvents(project.id).at(-1)).toMatchObject({
      sequence: 6,
      baseRevision: 3,
      revision: 4,
      type: "resource-updated",
    });
    expect(updated.revision).toBe(2);
  });

  it("rejects malformed lifecycle history atomically", async () => {
    const source = await domain();
    const root = await fixture();
    const project = source.projects.create({ goal: "Reject invalid replay" });
    await source.projectWorkspaces.create(project.id, root);
    const nodeA = source.nodes.create({ projectId: project.id, objective: objective("A") });
    const resource = await source.resources.create({
      projectId: project.id,
      sourceNodeId: nodeA.node.id,
      name: "Resource",
      description: "Replay",
      type: "text/plain",
      entryRef: "entry.txt",
    });
    source.resources.update({
      projectId: project.id,
      resourceId: resource.id,
      expectedRevision: 1,
      changes: { name: "Updated" },
    });
    const history = JSON.parse(JSON.stringify(source.resources.getEvents(project.id)));

    const target = await restoreDomain(source, project.id, [nodeA], root);
    history[1].baseRevision = 0;
    await expect(target.resources.restore(project.id, history))
      .rejects.toMatchObject({ code: "invalid-history" });
    expect(target.resourceStore.hasHistory(project.id)).toBe(false);
    expect(target.resources.listByProject(project.id)).toEqual([]);
  });

  it("rejects old schemas, invalid shared Nodes, duplicate event ids, and duplicate Resource ids", async () => {
    const source = await domain();
    const root = await fixture();
    const project = source.projects.create({ goal: "Strict replay" });
    await source.projectWorkspaces.create(project.id, root);
    const nodeA = source.nodes.create({ projectId: project.id, objective: objective("A") });
    const nodeB = source.nodes.create({ projectId: project.id, objective: objective("B") });
    const resource = await source.resources.create({
      projectId: project.id,
      sourceNodeId: nodeA.node.id,
      name: "Resource",
      description: "Replay",
      type: "text/plain",
      entryRef: "entry.txt",
    });
    source.resources.setAccess({
      projectId: project.id,
      resourceId: resource.id,
      expectedRevision: 1,
      access: { kind: "shared", nodeIds: [nodeB.node.id] },
    });
    const valid = JSON.parse(JSON.stringify(source.resources.getEvents(project.id)));

    const oldSchema = JSON.parse(JSON.stringify(valid));
    oldSchema[0].version = 1;
    const targetA = await restoreDomain(source, project.id, [nodeA, nodeB], root);
    await expect(targetA.resources.restore(project.id, oldSchema))
      .rejects.toMatchObject({ code: "invalid-history" });

    const invalidNode = JSON.parse(JSON.stringify(valid));
    invalidNode[1].data.access.nodeIds = ["missing-node"];
    const targetB = await restoreDomain(source, project.id, [nodeA, nodeB], root);
    await expect(targetB.resources.restore(project.id, invalidNode))
      .rejects.toMatchObject({ code: "invalid-history" });

    const duplicateEvent = JSON.parse(JSON.stringify(valid));
    duplicateEvent[1].id = duplicateEvent[0].id;
    const targetC = await restoreDomain(source, project.id, [nodeA, nodeB], root);
    await expect(targetC.resources.restore(project.id, duplicateEvent))
      .rejects.toMatchObject({ code: "invalid-history" });

    const otherProject = source.projects.create({ goal: "Other" });
    const otherRoot = await fixture();
    await source.projectWorkspaces.create(otherProject.id, otherRoot);
    const otherNode = source.nodes.create({
      projectId: otherProject.id,
      objective: objective("other"),
    });
    const duplicateResource = [JSON.parse(JSON.stringify(valid[0]))];
    duplicateResource[0].id = "other-project-create-event";
    duplicateResource[0].projectId = otherProject.id;
    duplicateResource[0].sequence = 1;
    duplicateResource[0].data.sourceNodeId = otherNode.node.id;

    const targetD = await domain();
    targetD.projects.restore(
      project.id,
      JSON.parse(JSON.stringify(source.projects.getEvents(project.id))),
    );
    targetD.nodes.restore(
      nodeA.node.id,
      JSON.parse(JSON.stringify(source.nodes.getEvents(nodeA.node.id))),
    );
    targetD.nodes.restore(
      nodeB.node.id,
      JSON.parse(JSON.stringify(source.nodes.getEvents(nodeB.node.id))),
    );
    await targetD.projectWorkspaces.create(project.id, root);
    await targetD.resources.restore(project.id, valid);

    targetD.projects.restore(
      otherProject.id,
      JSON.parse(JSON.stringify(source.projects.getEvents(otherProject.id))),
    );
    targetD.nodes.restore(
      otherNode.node.id,
      JSON.parse(JSON.stringify(source.nodes.getEvents(otherNode.node.id))),
    );
    await targetD.projectWorkspaces.create(otherProject.id, otherRoot);
    await expect(targetD.resources.restore(otherProject.id, duplicateResource))
      .rejects.toMatchObject({ code: "resource-already-exists" });
  });
});
