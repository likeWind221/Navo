import { stat, readFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import * as assets from "../../../src/resource/assets.js";
import { rawSql } from "../../helpers/storage.js";
import { fixture, open, operation } from "./helpers.js";

afterEach(() => vi.restoreAllMocks());

it("preserves committed success when cleanup fails, then retries it at startup", async () => {
  const { ctx, input, path, workspace } = await fixture();
  const first = await ctx.resources.publish(input);
  vi.spyOn(assets, "removeVersion").mockRejectedValueOnce(new Error("injected file busy"));
  const next = await ctx.resources.replace({ projectId: input.projectId, resourceId: first.id, actor: input.owner,
    expectedRevision: 1, sourceRef: input.sourceRef, operationId: "replace" });
  expect(operation(ctx, "replace")).toMatchObject({ business_result: "succeeded", execution_state: "cleanup_pending", error_code: "injected file busy" });
  expect(await readFile(join(workspace.assetsRoot, next.id, next.entryRef), "utf8")).toBe("generation one");
  await ctx.fiber.dispose();
  const restored = await open(path);
  expect(operation(restored, "replace")).toMatchObject({ business_result: "succeeded", execution_state: "completed" });
  expect(restored.resources.get(input.projectId, next.id)).toEqual(next);
  await expect(stat(join(workspace.assetsRoot, first.id, first.entryRef))).rejects.toMatchObject({ code: "ENOENT" });
});

it("does not report committed creation or deletion as failed when the cleanup progress write itself fails", async () => {
  const { ctx, input, path } = await fixture();
  rawSql(path, "CREATE TRIGGER fail_cleanup BEFORE UPDATE ON resource_file_operations WHEN NEW.execution_state = 'cleanup_pending' BEGIN SELECT RAISE(ABORT, 'cleanup progress unavailable'); END;");
  const resource = await ctx.resources.publish({ ...input, operationId: "create" });
  expect(operation(ctx, "create")).toMatchObject({ business_result: "succeeded", execution_state: "committed" });
  await ctx.resources.delete({ projectId: input.projectId, resourceId: resource.id, actor: input.owner, expectedRevision: 1, operationId: "delete" });
  expect(operation(ctx, "delete")).toMatchObject({ business_result: "succeeded", execution_state: "committed" });
  rawSql(path, "DROP TRIGGER fail_cleanup");
  await ctx.fiber.dispose();
  const restored = await open(path);
  expect(operation(restored, "delete").execution_state).toBe("completed");
  expect(restored.resources.get(input.projectId, resource.id)).toBeUndefined();
});

it.each(["staging", "prepared"] as const)("compensates an uncommitted %s target at startup using events, rather than treating file existence as commit", async execution_state => {
  const { ctx, input, path, workspace } = await fixture();
  const first = await ctx.resources.publish({ ...input, operationId: "interrupted" });
  ctx.storage.atomic(tx => tx.updateFileOperation({ ...operation(ctx, "interrupted"), execution_state, business_result: "pending" }));
  await ctx.fiber.dispose();
  rawSql(path, "DELETE FROM events WHERE domain = 'resource'");
  const restored = await open(path);
  expect(restored.resources.listByProject(input.projectId)).toEqual([]);
  expect(operation(restored, "interrupted")).toMatchObject({ business_result: "failed", execution_state: "failed" });
  await expect(stat(join(workspace.assetsRoot, first.id, first.entryRef))).rejects.toMatchObject({ code: "ENOENT" });
  await restored.resources.recover();
  expect(restored.resources.getEvents(input.projectId)).toEqual([]);
});

it("cleans an empty version directory left before its ownership marker and allows a later replacement", async () => {
  const { ctx, input, path, workspace } = await fixture();
  const first = await ctx.resources.publish(input);
  const lease = await ctx.resources.resolveEntry(input.projectId, first.id, input.owner);
  await ctx.resources.replace({ projectId: input.projectId, resourceId: first.id, actor: input.owner, expectedRevision: 1,
    sourceRef: input.sourceRef, operationId: "interrupted" });
  lease.release();
  await rm(join(workspace.assetsRoot, first.id, "versions", "2"), { recursive: true });
  await mkdir(join(workspace.assetsRoot, first.id, "versions", "2"));
  ctx.storage.atomic(tx => tx.updateFileOperation({ ...operation(ctx, "interrupted"), execution_state: "staging", business_result: "pending", cleanup_targets_json: "[]" }));
  await ctx.fiber.dispose();
  rawSql(path, "DELETE FROM events WHERE domain = 'resource' AND seq = 2");
  const restored = await open(path);
  expect(operation(restored, "interrupted").execution_state).toBe("failed");
  await expect(stat(join(workspace.assetsRoot, first.id, "versions", "2"))).rejects.toMatchObject({ code: "ENOENT" });
  expect((await restored.resources.replace({ projectId: input.projectId, resourceId: first.id, actor: input.owner,
    expectedRevision: 1, sourceRef: input.sourceRef })).assetGeneration).toBe(2);
});

it("cancels before commit and keeps failed compensation pending until a later recovery", async () => {
  const { ctx, input } = await fixture();
  const controller = new AbortController();
  const prepare = assets.prepareVersion;
  vi.spyOn(assets, "prepareVersion").mockImplementationOnce(async (...args) => { await prepare(...args); controller.abort(); });
  vi.spyOn(assets, "removeVersion").mockRejectedValueOnce(new Error("injected cleanup failure"));
  await expect(ctx.resources.publish({ ...input, operationId: "cancelled" }, controller.signal)).rejects.toMatchObject({ name: "AbortError" });
  expect(ctx.resources.listByProject(input.projectId)).toEqual([]);
  expect(operation(ctx, "cancelled")).toMatchObject({ business_result: "cancelled", execution_state: "cleanup_pending" });
  await ctx.resources.recover();
  expect(operation(ctx, "cancelled")).toMatchObject({ business_result: "cancelled", execution_state: "cancelled" });
});

it("reports a missing committed current asset and preserves the recovery evidence", async () => {
  const { ctx, input, path, workspace } = await fixture();
  const first = await ctx.resources.publish({ ...input, operationId: "missing" });
  ctx.storage.atomic(tx => tx.updateFileOperation({ ...operation(ctx, "missing"), execution_state: "committed" }));
  const { rm } = await import("node:fs/promises");
  await rm(join(workspace.assetsRoot, first.id, first.entryRef));
  await ctx.fiber.dispose();
  const restored = await open(path);
  expect(operation(restored, "missing")).toMatchObject({ business_result: "succeeded", execution_state: "cleanup_pending", error_code: expect.stringContaining("ENOENT") });
  await expect(restored.resources.withEntry(input.projectId, first.id, input.owner, async () => "unreachable")).rejects.toMatchObject({ code: "resource-content-unavailable" });
});

it("refuses old Resource histories explicitly without changing ordinary Project data or user files", async () => {
  const { ctx, input, path, root } = await fixture();
  await ctx.resources.publish(input);
  await ctx.fiber.dispose();
  rawSql(path, "UPDATE events SET payload = json_set(payload, '$.version', 3) WHERE domain = 'resource'");
  await expect(open(path)).rejects.toThrow("Legacy Resource history");
  expect(await readFile(join(root, input.sourceRef), "utf8")).toBe("generation one");
});
