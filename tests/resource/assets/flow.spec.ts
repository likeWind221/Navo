import { readFile, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as assets from "../../../src/resource/assets.js";
import { rawSql } from "../../helpers/storage.js";
import { deferred, fixture, operation } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

it("does not resurrect a Resource deleted while replacement is preparing its file", async () => {
  const { ctx, input } = await fixture();
  const first = await ctx.resources.publish(input);
  const started = deferred();
  const resume = deferred();
  const prepare = assets.prepareVersion;
  vi.spyOn(assets, "prepareVersion").mockImplementationOnce(async (...args) => {
    started.resolve();
    await resume.promise;
    await prepare(...args);
  });
  const replacing = ctx.resources.replace({ projectId: input.projectId, actor: input.owner, resourceId: first.id,
    expectedRevision: 1, sourceRef: input.sourceRef, operationId: "replace" });
  const outcome = expect(replacing).rejects.toMatchObject({ code: "resource-unavailable" });
  await started.promise;
  await ctx.resources.delete({ projectId: input.projectId, resourceId: first.id, actor: input.owner, expectedRevision: 1 });
  resume.resolve();
  await outcome;
  expect(ctx.resources.get(input.projectId, first.id)).toBeUndefined();
  expect(operation(ctx, "replace")).toMatchObject({ business_result: "failed", execution_state: "failed" });
});

it("reserves a replacement generation exclusively before copying, without deleting the winner's file", async () => {
  const { ctx, input } = await fixture();
  const first = await ctx.resources.publish(input);
  const started = deferred();
  const resume = deferred();
  const prepare = assets.prepareVersion;
  vi.spyOn(assets, "prepareVersion").mockImplementationOnce(async (...args) => { started.resolve(); await resume.promise; await prepare(...args); });
  const replacement = { projectId: input.projectId, actor: input.owner, resourceId: first.id, expectedRevision: 1, sourceRef: input.sourceRef };
  const winner = ctx.resources.replace({ ...replacement, operationId: "winner" });
  await started.promise;
  await expect(ctx.resources.replace({ ...replacement, operationId: "loser" })).rejects.toThrow("UNIQUE constraint failed");
  resume.resolve();
  expect((await winner).assetGeneration).toBe(2);
  expect(await ctx.resources.withEntry(input.projectId, first.id, input.owner, async (_resource, target) => readFile(target.path, "utf8"))).toBe("generation one");
  expect(ctx.resources.getEvents(input.projectId)).toHaveLength(2);
});

it("creates, replaces and deletes immutable generations without changing metadata or owner", async () => {
  const { ctx, root, workspace, input } = await fixture();
  const first = await ctx.resources.publish({ ...input, operationId: "create" });
  await writeFile(join(root, "report.md"), "generation two");
  const next = await ctx.resources.replace({ projectId: input.projectId, actor: input.owner, resourceId: first.id,
    expectedRevision: 1, sourceRef: "report.md", operationId: "replace" });
  expect(next).toMatchObject({ id: first.id, name: first.name, description: first.description, libraryPath: "report.md",
    owner: first.owner, access: first.access, assetGeneration: 2, revision: 2 });
  expect(await readFile(join(workspace.assetsRoot, next.id, next.entryRef), "utf8")).toBe("generation two");
  await expect(stat(join(workspace.assetsRoot, first.id, first.entryRef))).rejects.toMatchObject({ code: "ENOENT" });
  await ctx.resources.delete({ projectId: input.projectId, actor: input.owner, resourceId: first.id, expectedRevision: 2, operationId: "delete" });
  expect(ctx.resources.get(input.projectId, first.id)).toBeUndefined();
  expect(operation(ctx, "delete")).toMatchObject({ execution_state: "completed", business_result: "succeeded" });
  await expect(stat(join(workspace.assetsRoot, next.id, next.entryRef))).rejects.toMatchObject({ code: "ENOENT" });
});

it("replays the same operation without a second Resource, version or deletion, and rejects changed input", async () => {
  const { ctx, input } = await fixture();
  const request = { ...input, operationId: "same" };
  const [first, concurrent] = await Promise.all([ctx.resources.publish(request), ctx.resources.publish(request)]);
  expect(concurrent).toEqual(first);
  expect(await ctx.resources.publish(request)).toEqual(first);
  expect(ctx.resources.getEvents(input.projectId)).toHaveLength(1);
  await expect(ctx.resources.publish({ ...request, name: "Different" })).rejects.toMatchObject({ code: "invalid-resource" });
  const replacement = { projectId: input.projectId, actor: input.owner, resourceId: first.id, sourceRef: input.sourceRef, expectedRevision: 1, operationId: "replace" };
  const second = await ctx.resources.replace(replacement);
  expect(await ctx.resources.replace(replacement)).toEqual(second);
  const deletion = { ...replacement, expectedRevision: 2, operationId: "delete" };
  await ctx.resources.delete(deletion);
  await ctx.resources.delete(deletion);
  expect(ctx.resources.getEvents(input.projectId)).toHaveLength(3);
});

it("rolls back Resource and committed marker when operation update aborts, keeping the old version readable", async () => {
  const { ctx, input, path } = await fixture();
  const first = await ctx.resources.publish(input);
  rawSql(path, "CREATE TRIGGER fail_commit BEFORE UPDATE ON resource_file_operations WHEN NEW.execution_state = 'committed' BEGIN SELECT RAISE(ABORT, 'injected operation commit failure'); END;");
  await expect(ctx.resources.replace({ projectId: input.projectId, actor: input.owner, resourceId: first.id, sourceRef: input.sourceRef,
    expectedRevision: 1, operationId: "failed" })).rejects.toThrow("injected operation commit failure");
  expect(ctx.resources.get(input.projectId, first.id)).toEqual(first);
  expect(ctx.resources.getEvents(input.projectId)).toHaveLength(1);
  expect(operation(ctx, "failed")).toMatchObject({ business_result: "failed", execution_state: "failed" });
  expect(await ctx.resources.withEntry(input.projectId, first.id, input.owner, async (_resource, target) => readFile(target.path, "utf8"))).toBe("generation one");
});

it("pins in-flight reads to the old generation across replacement and keeps it until lease release", async () => {
  const { ctx, root, workspace, input } = await fixture();
  const first = await ctx.resources.publish(input);
  const started = deferred();
  const finish = deferred();
  const reading = ctx.resources.withEntry(input.projectId, first.id, input.owner, async (resource, target) => {
    expect(resource.assetGeneration).toBe(1);
    started.resolve();
    await finish.promise;
    return readFile(target.path, "utf8");
  });
  await started.promise;
  await writeFile(join(root, "report.md"), "generation two");
  const second = await ctx.resources.replace({ projectId: input.projectId, actor: input.owner, resourceId: first.id,
    expectedRevision: 1, sourceRef: "report.md", operationId: "replace" });
  expect(operation(ctx, "replace")).toMatchObject({ business_result: "succeeded", execution_state: "cleanup_pending" });
  expect(await readFile(join(workspace.assetsRoot, first.id, first.entryRef), "utf8")).toBe("generation one");
  expect(await ctx.resources.withEntry(input.projectId, first.id, input.owner, async (_resource, target) => readFile(target.path, "utf8"))).toBe("generation two");
  finish.resolve();
  expect(await reading).toBe("generation one");
  expect(operation(ctx, "replace").execution_state).toBe("completed");
  await expect(stat(join(workspace.assetsRoot, first.id, first.entryRef))).rejects.toMatchObject({ code: "ENOENT" });
  expect(second.assetGeneration).toBe(2);
});

it("deletion rejects new leases but lets an admitted read finish before cleanup", async () => {
  const { ctx, workspace, input } = await fixture();
  const first = await ctx.resources.publish(input);
  const started = deferred();
  const finish = deferred();
  const reading = ctx.resources.withEntry(input.projectId, first.id, input.owner, async (_resource, target) => {
    started.resolve();
    await finish.promise;
    return readFile(target.path, "utf8");
  });
  await started.promise;
  await ctx.resources.delete({ projectId: input.projectId, resourceId: first.id, actor: input.owner, expectedRevision: 1, operationId: "delete" });
  await expect(ctx.resources.withEntry(input.projectId, first.id, input.owner, async () => "denied")).rejects.toMatchObject({ code: "resource-unavailable" });
  expect(operation(ctx, "delete").execution_state).toBe("cleanup_pending");
  finish.resolve();
  expect(await reading).toBe("generation one");
  expect(operation(ctx, "delete").execution_state).toBe("completed");
  await expect(stat(join(workspace.assetsRoot, first.id, first.entryRef))).rejects.toMatchObject({ code: "ENOENT" });
});

it("releases leases after read failures so logical deletion can clean the asset", async () => {
  const { ctx, input } = await fixture();
  const first = await ctx.resources.publish(input);
  await expect(ctx.resources.withEntry(input.projectId, first.id, input.owner, async () => { throw new Error("read failed"); })).rejects.toThrow("read failed");
  await ctx.resources.delete({ projectId: input.projectId, resourceId: first.id, actor: input.owner, expectedRevision: 1, operationId: "delete" });
  expect(operation(ctx, "delete").execution_state).toBe("completed");
});
