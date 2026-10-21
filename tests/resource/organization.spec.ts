import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { rawSql } from "../helpers/storage.js";
import { ResourceError } from "../../src/resource/errors.js";
import { fixture, open } from "./assets/helpers.js";

it("persists empty folders and moves a resource without changing its asset or access", async () => {
  const { ctx, path, project, workspace, input } = await fixture();
  const folder = ctx.userResources.createFolder(project.id, "Papers");
  expect(folder.path).toBe("Papers");
  expect(ctx.userResources.createFolder(project.id, "papers").path).toBe("papers (1)");
  const resource = await ctx.resources.publish(input);
  const moved = ctx.userResources.organizeResource({ projectId: project.id, resourceId: resource.id,
    expectedRevision: resource.revision, folder: "Papers", name: "renamed.md" });
  expect(moved).toMatchObject({ id: resource.id, owner: resource.owner, access: resource.access,
    libraryPath: "Papers/renamed.md", name: "renamed.md", assetGeneration: resource.assetGeneration });
  expect(ctx.userResources.browse(project.id).directories.map(item => item.path).sort())
    .toEqual(["Papers", "papers (1)"].sort());
  expect(ctx.userResources.browse(project.id, "Papers").resources[0]?.resource).toEqual(moved);
  expect(await readFile(join(workspace.assetsRoot, resource.id, resource.entryRef), "utf8")).toBe("generation one");
  await ctx.fiber.dispose();
  const restored = await open(path);
  expect(restored.userResources.folders(project.id)).toEqual(expect.arrayContaining([
    { path: "Papers", explicit: true }, { path: "papers (1)", explicit: true },
  ]));
  expect(restored.resources.get(project.id, resource.id)).toEqual(moved);
});

it("keeps the older user metadata entry consistent when it changes a name", async () => {
  const { ctx, project, input } = await fixture();
  const resource = await ctx.resources.publish(input);
  const updated = ctx.userResources.update({ projectId: project.id, resourceId: resource.id,
    expectedRevision: 1, changes: { name: "final.md", description: "Final report" } });
  expect(updated).toMatchObject({ name: "final.md", libraryPath: "final.md", description: "Final report", revision: 3,
    id: resource.id, assetGeneration: resource.assetGeneration });
  expect(ctx.resources.getEvents(project.id).slice(-2).map(event => event.type))
    .toEqual(["resource-organized", "resource-updated"]);
  const renamed = ctx.userResources.update({ projectId: project.id, resourceId: resource.id,
    expectedRevision: 3, changes: { name: "final-2.md" } });
  expect(renamed).toMatchObject({ name: "final-2.md", libraryPath: "final-2.md", revision: 4 });
  expect(ctx.resources.getEvents(project.id).at(-1)?.type).toBe("resource-organized");
});

it("moves a whole directory in one transaction and rejects collisions", async () => {
  const { ctx, project, input, root } = await fixture();
  ctx.userResources.createFolder(project.id, "old");
  ctx.userResources.createFolder(project.id, "new");
  const first = await ctx.resources.publish(input);
  await writeFile(join(root, "second.md"), "second");
  const second = await ctx.resources.publish({ ...input, sourceRef: "second.md", name: "Second" });
  for (const resource of [first, second]) ctx.userResources.organizeResource({ projectId: project.id,
    resourceId: resource.id, expectedRevision: 1, folder: "old" });
  const before = ctx.resources.getEvents(project.id).length;
  expect(() => ctx.userResources.organizeFolder(project.id, "old", "new"))
    .toThrow(expect.objectContaining({ code: "folder-conflict" }));
  expect(ctx.resources.getEvents(project.id)).toHaveLength(before);
  ctx.userResources.organizeFolder(project.id, "old", "renamed");
  expect(ctx.resources.getEvents(project.id)).toHaveLength(before + 2);
  expect(ctx.resources.listByProject(project.id).map(resource => resource.libraryPath).sort())
    .toEqual(["renamed/report.md", "renamed/second.md"]);
  expect(ctx.userResources.folders(project.id)).toContainEqual({ path: "renamed", explicit: true });
});

it("rolls back folder paths and Resource projections when a transaction fails", async () => {
  const { ctx, project, input } = await fixture();
  ctx.userResources.createFolder(project.id, "old");
  const resource = await ctx.resources.publish(input);
  ctx.userResources.organizeResource({ projectId: project.id, resourceId: resource.id,
    expectedRevision: 1, folder: "old" });
  const before = ctx.resources.get(project.id, resource.id);
  expect(() => ctx.storage.atomic(() => {
    ctx.userResources.organizeFolder(project.id, "old", "new");
    throw new Error("injected failure");
  })).toThrow("injected failure");
  expect(ctx.resources.get(project.id, resource.id)).toEqual(before);
  expect(ctx.userResources.folders(project.id)).toContainEqual({ path: "old", explicit: true });
  expect(ctx.userResources.folders(project.id)).not.toContainEqual({ path: "new", explicit: true });
});

it("rolls back every path when the second Resource event cannot be stored", async () => {
  const { ctx, path, project, input, root } = await fixture();
  ctx.userResources.createFolder(project.id, "old");
  const first = await ctx.resources.publish(input);
  await writeFile(join(root, "second.md"), "second");
  const second = await ctx.resources.publish({ ...input, sourceRef: "second.md", name: "Second" });
  for (const resource of [first, second]) ctx.userResources.organizeResource({ projectId: project.id,
    resourceId: resource.id, expectedRevision: 1, folder: "old" });
  const before = ctx.resources.getEvents(project.id).length;
  rawSql(path, `CREATE TRIGGER fail_second BEFORE INSERT ON events
    WHEN NEW.domain = 'resource' AND NEW.seq = ${before + 2}
    BEGIN SELECT RAISE(ABORT, 'injected'); END;`);
  expect(() => ctx.userResources.organizeFolder(project.id, "old", "new")).toThrow();
  expect(ctx.resources.getEvents(project.id)).toHaveLength(before);
  expect(ctx.resources.listByProject(project.id).map(resource => resource.libraryPath).sort())
    .toEqual(["old/report.md", "old/second.md"]);
  expect(ctx.userResources.folders(project.id)).toContainEqual({ path: "old", explicit: true });
  expect(ctx.userResources.folders(project.id)).not.toContainEqual({ path: "new", explicit: true });
});

it("requires confirmation before recursive delete and uses existing lifecycle", async () => {
  const { ctx, project, input } = await fixture();
  ctx.userResources.createFolder(project.id, "folder");
  const resource = await ctx.resources.publish(input);
  ctx.userResources.organizeResource({ projectId: project.id, resourceId: resource.id,
    expectedRevision: 1, folder: "folder" });
  const request = { projectId: project.id, path: "folder", operationId: "deletefolder" };
  expect(await ctx.userResources.deleteFolder({ ...request, recursive: false }))
    .toMatchObject({ status: "confirmation-required", deleted: [] });
  expect(ctx.resources.get(project.id, resource.id)).toBeDefined();
  const controller = new AbortController();
  controller.abort();
  expect(await ctx.userResources.deleteFolder({ ...request, recursive: true, signal: controller.signal }))
    .toMatchObject({ status: "cancelled", deleted: [] });
  expect(ctx.resources.get(project.id, resource.id)).toBeDefined();
  expect(await ctx.userResources.deleteFolder({ ...request, recursive: true }))
    .toMatchObject({ status: "deleted", deleted: [resource.id], failed: [] });
  expect(ctx.resources.get(project.id, resource.id)).toBeUndefined();
  expect(ctx.userResources.folders(project.id)).toEqual([]);
});

it("keeps folder operations within the Project and resolves Unicode path collisions", async () => {
  const { ctx, project, input } = await fixture();
  expect(ctx.userResources.createFolder(project.id, "Cafe\u0301").path).toBe("Café");
  expect(ctx.userResources.createFolder(project.id, "CAFÉ").path).toBe("CAFÉ (1)");
  const resource = await ctx.resources.publish(input);
  const other = ctx.projects.create({ name: "Other", goal: null });
  expect(() => ctx.userResources.organizeResource({ projectId: other.id, resourceId: resource.id,
    expectedRevision: 1, folder: "" })).toThrow(expect.objectContaining({ code: "resource-unavailable" }));
  expect(() => ctx.userResources.organizeFolder(project.id, "Café", "Café/child"))
    .toThrow(expect.objectContaining({ code: "folder-conflict" }));
  expect(ctx.resources.get(project.id, resource.id)).toEqual(resource);
});

it("numbers a published file when an empty folder owns its target path", async () => {
  const { ctx, project, input } = await fixture();
  ctx.userResources.createFolder(project.id, "report.md");
  const resource = await ctx.resources.publish(input);
  expect(resource.libraryPath).toBe("report (1).md");
  expect(ctx.userResources.folders(project.id)).toContainEqual({ path: "report.md", explicit: true });
});

it("requires confirmation for a folder containing only empty subfolders", async () => {
  const { ctx, project } = await fixture();
  ctx.userResources.createFolder(project.id, "parent");
  ctx.userResources.createFolder(project.id, "parent/child");
  const input = { projectId: project.id, path: "parent", operationId: "emptytree" };
  expect(await ctx.userResources.deleteFolder({ ...input, recursive: false }))
    .toMatchObject({ status: "confirmation-required" });
  expect(ctx.userResources.folders(project.id)).toHaveLength(2);
  expect(await ctx.userResources.deleteFolder({ ...input, recursive: true }))
    .toMatchObject({ status: "deleted", deleted: [] });
  expect(ctx.userResources.folders(project.id)).toEqual([]);
});

it("reports partial recursive deletion and allows a retry", async () => {
  const { ctx, project, input, root } = await fixture();
  ctx.userResources.createFolder(project.id, "folder");
  const first = await ctx.resources.publish(input);
  await writeFile(join(root, "second.md"), "second");
  const second = await ctx.resources.publish({ ...input, sourceRef: "second.md", name: "Second" });
  for (const resource of [first, second]) ctx.userResources.organizeResource({ projectId: project.id,
    resourceId: resource.id, expectedRevision: 1, folder: "folder" });
  const deletion = vi.spyOn(ctx.resources, "deleteUser").mockImplementationOnce(() =>
    Promise.reject(new ResourceError("resource-unavailable", "injected failure")));
  const result = await ctx.userResources.deleteFolder({ projectId: project.id, path: "folder",
    recursive: true, operationId: "partial" });
  deletion.mockRestore();
  expect(result).toMatchObject({ status: "partial", deleted: [second.id],
    failed: [{ resourceId: first.id, code: "resource-unavailable" }] });
  expect(ctx.userResources.folders(project.id)).toContainEqual({ path: "folder", explicit: true });
  expect(await ctx.userResources.deleteFolder({ projectId: project.id, path: "folder",
    recursive: true, operationId: "retry" })).toMatchObject({ status: "deleted", deleted: [first.id] });
  expect(ctx.userResources.folders(project.id)).toEqual([]);
});
