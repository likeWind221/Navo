import {
  mkdtemp,
  rm,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import type { ProjectId } from "../../src/brand/ids.js";
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
  await ctx.plugin(ResourceService);
  return ctx;
}

async function restoreProject(
  source: Context,
  target: Context,
  projectId: ProjectId,
  root: string,
): Promise<void> {
  target.projects.restore(
    projectId,
    JSON.parse(JSON.stringify(source.projects.getEvents(projectId))),
  );
  for (const node of source.nodes.getByProject(projectId)) {
    target.nodes.restore(
      node.node.id,
      JSON.parse(JSON.stringify(source.nodes.getEvents(node.node.id))),
    );
  }
  await target.projectWorkspaces.create(projectId, root);
}

describe("Resource history replay v3", () => {
  it("replays Main and Node ownership, updates, access and delete", async () => {
    const source = await domain();
    const root = await fixture();
    const project = source.projects.create({ goal: "Replay" });
    await source.projectWorkspaces.create(project.id, root);
    const nodeA = source.nodes.create({ projectId: project.id, objective: objective("A") });
    const nodeB = source.nodes.create({ projectId: project.id, objective: objective("B") });
    await writeFile(join(root, "node.md"), "node\n", "utf8");
    await writeFile(join(root, "main.md"), "main\n", "utf8");

    const nodeResource = await source.resources.publish({
      projectId: project.id,
      owner: { kind: "node", nodeId: nodeA.node.id },
      sourceRef: "node.md",
      name: "Node",
      description: "Node resource",
      type: "text/markdown",
    });
    const updated = source.resources.update({
      projectId: project.id,
      actor: { kind: "node", nodeId: nodeA.node.id },
      resourceId: nodeResource.id,
      expectedRevision: 1,
      changes: { name: "Node updated" },
    });
    const shared = source.resources.setAccess({
      projectId: project.id,
      actor: { kind: "main" },
      resourceId: nodeResource.id,
      expectedRevision: 2,
      access: { kind: "shared", nodeIds: [nodeB.node.id] },
    });

    const mainResource = await source.resources.publish({
      projectId: project.id,
      owner: { kind: "main" },
      sourceRef: "main.md",
      name: "Main",
      description: "Main resource",
      type: "text/markdown",
    });
    source.resources.delete({
      projectId: project.id,
      actor: { kind: "main" },
      resourceId: mainResource.id,
      expectedRevision: 1,
    });

    const target = await domain();
    await restoreProject(source, target, project.id, root);
    const history = JSON.parse(JSON.stringify(source.resources.getEvents(project.id)));
    const restored = await target.resources.restore(project.id, history);

    expect(restored).toEqual([shared]);
    expect(restored[0]).toMatchObject({
      owner: { kind: "node", nodeId: nodeA.node.id },
      name: "Node updated",
      revision: 3,
      access: { kind: "shared", nodeIds: [nodeB.node.id] },
    });
    expect(updated.revision).toBe(2);
    expect(target.resources.get(project.id, mainResource.id)).toBeUndefined();
  });

  it("rejects v2 history and invalid owner atomically", async () => {
    const source = await domain();
    const root = await fixture();
    const project = source.projects.create({ goal: "Strict replay" });
    await source.projectWorkspaces.create(project.id, root);
    await writeFile(join(root, "main.md"), "main\n", "utf8");
    await source.resources.publish({
      projectId: project.id,
      owner: { kind: "main" },
      sourceRef: "main.md",
      name: "Main",
      description: "Main resource",
      type: "text/markdown",
    });
    const valid = JSON.parse(JSON.stringify(source.resources.getEvents(project.id)));

    const v2 = JSON.parse(JSON.stringify(valid));
    v2[0].version = 2;
    const targetA = await domain();
    await restoreProject(source, targetA, project.id, root);
    await expect(targetA.resources.restore(project.id, v2))
      .rejects.toMatchObject({ code: "invalid-history" });
    expect(targetA.resources.getEvents(project.id)).toEqual([]);

    const invalidOwner = JSON.parse(JSON.stringify(valid));
    invalidOwner[0].data.owner = { kind: "node", nodeId: "missing-node" };
    const targetB = await domain();
    await restoreProject(source, targetB, project.id, root);
    await expect(targetB.resources.restore(project.id, invalidOwner))
      .rejects.toMatchObject({ code: "invalid-history" });
    expect(targetB.resources.getEvents(project.id)).toEqual([]);
  });

  it("rejects duplicate Resource identity across Projects", async () => {
    const source = await domain();
    const rootA = await fixture();
    const rootB = await fixture();
    const projectA = source.projects.create({ goal: "A" });
    const projectB = source.projects.create({ goal: "B" });
    await source.projectWorkspaces.create(projectA.id, rootA);
    await source.projectWorkspaces.create(projectB.id, rootB);
    await writeFile(join(rootA, "a.md"), "a\n", "utf8");

    await source.resources.publish({
      projectId: projectA.id,
      owner: { kind: "main" },
      sourceRef: "a.md",
      name: "A",
      description: "A",
      type: "text/markdown",
    });
    const historyA = JSON.parse(JSON.stringify(source.resources.getEvents(projectA.id)));
    const duplicate = [JSON.parse(JSON.stringify(historyA[0]))];
    duplicate[0].id = "other-create-event";
    duplicate[0].projectId = projectB.id;
    duplicate[0].sequence = 1;

    const target = await domain();
    await restoreProject(source, target, projectA.id, rootA);
    await target.resources.restore(projectA.id, historyA);
    await restoreProject(source, target, projectB.id, rootB);
    await expect(target.resources.restore(projectB.id, duplicate))
      .rejects.toMatchObject({ code: "resource-already-exists" });
  });
});
