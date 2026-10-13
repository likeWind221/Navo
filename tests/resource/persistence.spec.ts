import { mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { dirname, join } from "node:path";
import { Context } from "cordis";
import { afterEach, expect, it } from "vitest";
import { MailboxStore } from "../../src/mailbox/store.js";
import { NodeStore } from "../../src/node/store.js";
import { ProjectStore } from "../../src/project/store.js";
import { ResourceService } from "../../src/resource/service.js";
import { StorageService } from "../../src/storage/database.js";
import { ProjectWorkspaceStore } from "../../src/workspace/store.js";
import { rawSql, removeRoots, temporaryDatabase } from "../helpers/storage.js";

const contexts: Context[] = [];
const roots: string[] = [];
afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
  await removeRoots(roots);
});
async function open(path: string) {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(StorageService, { path });
  await ctx.plugin(ProjectStore);
  await ctx.plugin(NodeStore);
  await ctx.plugin(ProjectWorkspaceStore);
  await ctx.plugin(MailboxStore);
  await ctx.plugin(ResourceService);
  return ctx;
}
async function seed() {
  const path = await temporaryDatabase(roots, "navo-handoff-");
  const ctx = await open(path);
  const projectId = ctx.projects.create({ name: "Project", goal: "Persist" }).id;
  const nodeId = ctx.nodes.create({ projectId, objective: { title: "Work", description: "Work", acceptanceCriteria: ["Done"] } }).node.id;
  const root = join(dirname(path), "workspace");
  await mkdir(root);
  const workspace = await ctx.projectWorkspaces.create(projectId, root);
  await writeFile(join(root, "report.md"), "result");
  const publish = () => ctx.resources.publish({ projectId, owner: { kind: "node", nodeId }, sourceRef: "report.md", name: "Report", description: "Findings", type: "text/markdown" });
  return { ctx, path, projectId, nodeId, root, workspace, publish };
}
it("restores messages and Resource lifecycle and continues their sequences", async () => {
  const { ctx, path, projectId, nodeId, publish } = await seed();
  ctx.mailbox.postFromMain({ projectId, nodeId, body: "Start" });
  ctx.mailbox.postFromNode({ projectId, nodeId, body: "Done" });
  const resource = await publish();
  ctx.resources.update({ projectId, resourceId: resource.id, actor: resource.owner, expectedRevision: 1, changes: { name: "Final" } });
  ctx.resources.setAccess({ projectId, resourceId: resource.id, actor: { kind: "main" }, expectedRevision: 2, access: { kind: "public" } });
  const deleted = await publish();
  ctx.resources.delete({ projectId, resourceId: deleted.id, actor: deleted.owner, expectedRevision: 1 });
  const messages = ctx.mailbox.getHistory(projectId);
  const events = ctx.resources.getEvents(projectId);
  const list = ctx.resources.listByProject(projectId);
  await ctx.fiber.dispose();
  const restored = await open(path);
  expect(restored.mailbox.getHistory(projectId)).toEqual(messages);
  expect(restored.resources.getEvents(projectId)).toEqual(events);
  expect(restored.resources.listByProject(projectId)).toEqual(list);
  expect(restored.resources.get(projectId, deleted.id)).toBeUndefined();
  const target = await restored.resources.resolveEntry(projectId, resource.id);
  expect(await readFile(target.path, "utf8")).toBe("result");
  expect(restored.mailbox.postFromNode({ projectId, nodeId, body: "Again" }).sequence).toBe(3);
  expect(restored.resources.update({ projectId, resourceId: resource.id, actor: resource.owner, expectedRevision: 3, changes: { name: "Next" } }).revision).toBe(4);
});
it("keeps metadata when the Workspace is missing", async () => {
  const { ctx, path, projectId, root, publish } = await seed();
  const resource = await publish();
  await ctx.fiber.dispose();
  await rm(root, { recursive: true });
  const restored = await open(path);
  expect(restored.resources.get(projectId, resource.id)).toEqual(resource);
  await expect(restored.resources.resolveEntry(projectId, resource.id)).rejects.toMatchObject({ code: "workspace-unavailable" });
});
it("isolates one corrupted Project while restoring another", async () => {
  const { ctx, path, projectId, nodeId, publish } = await seed();
  ctx.mailbox.postFromNode({ projectId, nodeId, body: "Broken project" });
  await publish();

  const otherProject = ctx.projects.create({ name: "Other", goal: "Survive" }).id;
  const otherNode = ctx.nodes.create({
    projectId: otherProject,
    objective: { title: "Other work", description: "Other work", acceptanceCriteria: ["Done"] },
  }).node.id;
  const otherRoot = join(dirname(path), "other-workspace");
  await mkdir(otherRoot);
  await ctx.projectWorkspaces.create(otherProject, otherRoot);
  await writeFile(join(otherRoot, "report.md"), "Other result");
  ctx.mailbox.postFromNode({ projectId: otherProject, nodeId: otherNode, body: "Healthy project" });
  const otherResource = await ctx.resources.publish({
    projectId: otherProject,
    owner: { kind: "node", nodeId: otherNode },
    sourceRef: "report.md",
    name: "Other report",
    description: "Other findings",
    type: "text/markdown",
  });
  await ctx.fiber.dispose();

  const beforeDb = new DatabaseSync(path);
  const before = beforeDb.prepare(
    "SELECT payload FROM events WHERE domain = 'resource' AND project_id = ?",
  ).all(projectId).map(row => String(row.payload));
  beforeDb.close();
  const raw = new DatabaseSync(path);
  try {
    raw.prepare("UPDATE events SET payload = '{}' WHERE domain = 'resource' AND project_id = ?").run(projectId);
  } finally {
    raw.close();
  }

  const restored = await open(path);
  expect(restored.projects.get(projectId)).toBeUndefined();
  expect(restored.projects.get(otherProject)).toBeDefined();
  expect(restored.mailbox.getHistory(otherProject)).toHaveLength(1);
  expect(restored.resources.get(otherProject, otherResource.id)).toEqual(otherResource);

  const afterDb = new DatabaseSync(path);
  const after = afterDb.prepare(
    "SELECT payload FROM events WHERE domain = 'resource' AND project_id = ?",
  ).all(projectId).map(row => String(row.payload));
  afterDb.close();
  expect(after).toEqual(["{}"]);
  expect(before).not.toEqual(after);
});
it("does not expose failed writes or emit changes and removes unpublished content", async () => {
  const { ctx, path, projectId, nodeId, workspace, publish } = await seed();
  const resource = await publish();
  await new Promise(resolve => setTimeout(resolve, 0));
  const changed: string[] = [];
  ctx.on("project/changed", id => { changed.push(id); });
  rawSql(path, "CREATE TRIGGER fail_handoff BEFORE INSERT ON events WHEN NEW.domain IN ('mailbox', 'resource') BEGIN SELECT RAISE(ABORT, 'blocked'); END");
  expect(() => ctx.mailbox.postFromNode({ projectId, nodeId, body: "Fail" })).toThrow(expect.objectContaining({ code: "write-failed" }));
  await expect(publish()).rejects.toMatchObject({ code: "write-failed" });
  expect(await readdir(workspace.assetsRoot)).toEqual([resource.id]);
  expect(() => ctx.resources.update({ projectId, resourceId: resource.id, actor: resource.owner, expectedRevision: 1, changes: { name: "Fail" } })).toThrow();
  expect(() => ctx.resources.setAccess({ projectId, resourceId: resource.id, actor: { kind: "main" }, expectedRevision: 1, access: { kind: "public" } })).toThrow();
  expect(() => ctx.resources.delete({ projectId, resourceId: resource.id, actor: resource.owner, expectedRevision: 1 })).toThrow();
  expect(ctx.resources.listByProject(projectId)).toEqual([resource]);
  expect(ctx.resources.getEvents(projectId)).toHaveLength(1);
  expect(ctx.mailbox.getHistory(projectId)).toEqual([]);
  await new Promise(resolve => setTimeout(resolve, 0));
  expect(changed).toEqual([]);
});
it.each(["mailbox", "resource"])("isolates a Project with invalid stored %s history", async domain => {
  const { ctx, path, projectId, nodeId, publish } = await seed();
  ctx.mailbox.postFromNode({ projectId, nodeId, body: "Done" });
  await publish();
  await ctx.fiber.dispose();
  rawSql(path, `UPDATE events SET payload = '{}' WHERE domain = '${domain}'`);
  const restored = await open(path);
  expect(restored.projects.get(projectId)).toBeUndefined();
});

it.each(["mailbox", "resource"])("isolates a Project with a stored %s sequence gap", async domain => {
  const { ctx, path, projectId, nodeId, publish } = await seed();
  ctx.mailbox.postFromNode({ projectId, nodeId, body: "Done" });
  await publish();
  await ctx.fiber.dispose();
  rawSql(path, `UPDATE events SET seq = 2 WHERE domain = '${domain}'`);
  const restored = await open(path);
  expect(restored.projects.get(projectId)).toBeUndefined();
});
