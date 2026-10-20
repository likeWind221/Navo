import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it } from "vitest";
import { fixture, operation } from "./helpers.js";

it("returns the original create result on an immediate retry without writing again", async () => {
  const { ctx, root, workspace, input } = await fixture();
  const created = await ctx.resources.publish({ ...input, operationId: "create" });

  expect(await ctx.resources.publish({ ...input, operationId: "create" })).toEqual(created);
  expect(ctx.resources.getEvents(input.projectId)).toHaveLength(1);
  expect(operation(ctx, "create")).toMatchObject({ execution_state: "completed", business_result: "succeeded" });
  expect(await readFile(join(workspace.assetsRoot, created.id, created.entryRef), "utf8")).toBe("generation one");
  expect(await readFile(join(root, "report.md"), "utf8")).toBe("generation one");
});

it("does not present a later generation as the original create result", async () => {
  const { ctx, root, workspace, input } = await fixture();
  const created = await ctx.resources.publish({ ...input, operationId: "create" });
  await writeFile(join(root, "report.md"), "generation two");
  const replaced = await ctx.resources.replace({ projectId: input.projectId, actor: input.owner, resourceId: created.id,
    expectedRevision: 1, sourceRef: "report.md", operationId: "replace" });

  await expect(ctx.resources.publish({ ...input, operationId: "create" }))
    .rejects.toMatchObject({ code: "operation-result-stale" });
  expect(ctx.resources.getEvents(input.projectId)).toHaveLength(2);
  expect(ctx.resources.get(input.projectId, created.id)).toEqual(replaced);
  expect(await readFile(join(workspace.assetsRoot, replaced.id, replaced.entryRef), "utf8")).toBe("generation two");
  await expect(stat(join(workspace.assetsRoot, created.id, created.entryRef))).rejects.toMatchObject({ code: "ENOENT" });
});

it("does not resurrect a Resource deleted after creation", async () => {
  const { ctx, workspace, input } = await fixture();
  const created = await ctx.resources.publish({ ...input, operationId: "create" });
  await ctx.resources.delete({ projectId: input.projectId, actor: input.owner, resourceId: created.id,
    expectedRevision: 1, operationId: "delete" });

  await expect(ctx.resources.publish({ ...input, operationId: "create" }))
    .rejects.toMatchObject({ code: "resource-unavailable" });
  expect(ctx.resources.get(input.projectId, created.id)).toBeUndefined();
  expect(ctx.resources.getEvents(input.projectId)).toHaveLength(2);
  await expect(stat(join(workspace.assetsRoot, created.id, created.entryRef))).rejects.toMatchObject({ code: "ENOENT" });
});

it("does not present a later metadata revision as the original create result", async () => {
  const { ctx, input } = await fixture();
  const created = await ctx.resources.publish({ ...input, operationId: "create" });
  const updated = ctx.resources.update({ projectId: input.projectId, actor: input.owner, resourceId: created.id,
    expectedRevision: 1, changes: { name: "Renamed" } });

  await expect(ctx.resources.publish({ ...input, operationId: "create" }))
    .rejects.toMatchObject({ code: "operation-result-stale" });
  expect(ctx.resources.getEvents(input.projectId)).toHaveLength(2);
  expect(ctx.resources.get(input.projectId, created.id)).toEqual(updated);
  expect(updated.revision).toBe(2);
});

it("replays a committed delete without events or files being written again", async () => {
  const { ctx, workspace, input } = await fixture();
  const created = await ctx.resources.publish(input);
  const deletion = { projectId: input.projectId, actor: input.owner, resourceId: created.id,
    expectedRevision: 1, operationId: "delete" };

  await ctx.resources.delete(deletion);
  await expect(ctx.resources.delete(deletion)).resolves.toBeUndefined();
  expect(ctx.resources.getEvents(input.projectId)).toHaveLength(2);
  expect(operation(ctx, "delete")).toMatchObject({ execution_state: "completed", business_result: "succeeded" });
  await expect(stat(join(workspace.assetsRoot, created.id, created.entryRef))).rejects.toMatchObject({ code: "ENOENT" });
});
