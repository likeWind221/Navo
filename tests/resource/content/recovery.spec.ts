import { expect, it, vi } from "vitest";
import { DatabaseSync } from "node:sqlite";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { pendingContent } from "../../../src/resource/content/store.js";
import { rawSql } from "../../helpers/storage.js";
import { fixture, openContent, ready } from "./fixture.js";

it("reconciles missing/stale/interrupted rows and reverse-scans deleted, absent and unknown-project orphans idempotently", async () => {
  const { ctx, project, resource, path, input, root } = await fixture();
  await writeFile(join(root, "other.txt"), "other");
  const missing = await ctx.resources.publish({ ...input, sourceRef: "other.txt" });
  const deleted = await ctx.resources.publish({ ...input, sourceRef: "other.txt" });
  await ctx.resources.delete({ projectId: project.id, resourceId: deleted.id, actor: { kind: "main" }, expectedRevision: 1 });
  ctx.storage.atomic(tx => {
    tx.deleteResourceContent(project.id, missing.id);
    tx.claimResourceContent(project.id, resource.id, 1, "dead-host");
    for (const [p, r] of [[project.id, deleted.id], [project.id, "absent"], ["absent-project", "absent"]]) {
      tx.putResourceContent(pendingContent(p!, r!, 1));
    }
  });
  const before = ctx.resources.getEvents(project.id);
  await ctx.fiber.dispose();
  const restored = await openContent(path);
  expect(restored.content.status(project.id, resource.id)).toMatchObject({ status: "pending", processing_attempt_id: null });
  expect(restored.content.status(project.id, missing.id)?.status).toBe("pending");
  expect(restored.storage.atomic(tx => tx.listResourceContent())).toHaveLength(2);
  restored.content.start();
  await restored.content.idle();
  expect(restored.content.read(project.id, resource.id)?.body).toBe("# Original\n");
  expect(restored.content.read(project.id, missing.id)?.body).toBe("other");
  expect(restored.resources.getEvents(project.id)).toEqual(before);
  await restored.fiber.dispose();
  const repeated = await openContent(path);
  expect(repeated.storage.atomic(tx => tx.listResourceContent()).every(row => row.status === "ready")).toBe(true);
  expect(repeated.resources.getEvents(project.id)).toEqual(before);
});

it("invalidates stale ready and reconstructs the current generation on restart", async () => {
  const { ctx, project, resource, path, root } = await fixture();
  ctx.content.start();
  await ctx.content.idle();
  vi.spyOn(ctx.content, "notify").mockImplementation(() => {});
  await writeFile(join(root, "new.txt"), "new");
  await ctx.resources.replace({ projectId: project.id, resourceId: resource.id, actor: { kind: "main" }, expectedRevision: 1, sourceRef: "new.txt" });
  expect(ctx.content.read(project.id, resource.id)).toBeUndefined();
  await ctx.fiber.dispose();
  const restored = await openContent(path);
  expect(restored.content.status(project.id, resource.id)).toMatchObject({ status: "pending", source_asset_generation: 2, body: null });
  restored.content.start();
  await restored.content.idle();
  expect(restored.content.read(project.id, resource.id)).toMatchObject({ source_asset_generation: 2, body: "new" });
});

it("retains unavailable Project rows instead of treating failed recovery as deletion", async () => {
  const { ctx, project, resource, path } = await fixture();
  await ctx.fiber.dispose();
  rawSql(path, `UPDATE events SET payload = '{' WHERE domain = 'project' AND project_id = '${project.id}'`);
  const restored = await openContent(path);
  expect(restored.projects.get(project.id)).toBeUndefined();
  expect(restored.storage.atomic(tx => tx.getResourceContent(project.id, resource.id))).toBeDefined();
});

it("does not spin or publish partial ready after a SQLite result write fails; next startup recovers", async () => {
  const extract = vi.fn(async () => ready("recovered"));
  const { ctx, project, resource, path } = await fixture({ extractor: extract });
  rawSql(path, "CREATE TRIGGER ready_failure BEFORE UPDATE ON resource_content WHEN new.status = 'ready' BEGIN SELECT RAISE(ABORT, 'ready failure'); END;");
  const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    ctx.content.start();
    await ctx.content.idle();
    expect(ctx.content.status(project.id, resource.id)).toMatchObject({ status: "processing", body: null, page_map_json: null, extractor_version: null });
    ctx.content.notify(project.id, resource.id);
    await ctx.content.idle();
    expect(extract).toHaveBeenCalledOnce();
    expect(diagnostic).toHaveBeenCalledOnce();
    await ctx.fiber.dispose();
    rawSql(path, "DROP TRIGGER ready_failure;");
    const restored = await openContent(path, { extractor: extract });
    restored.content.start();
    await restored.content.idle();
    expect(restored.content.read(project.id, resource.id)?.body).toBe("recovered");
    expect(extract).toHaveBeenCalledTimes(2);
  } finally {
    diagnostic.mockRestore();
  }
});

it("does not immediately requeue when claiming or creating a pending row fails", async () => {
  const extract = vi.fn(async () => ready());
  const { ctx, project, resource, path } = await fixture({ extractor: extract });
  rawSql(path, "CREATE TRIGGER claim_failure BEFORE UPDATE ON resource_content WHEN new.status = 'processing' BEGIN SELECT RAISE(ABORT, 'claim failure'); END;");
  const diagnostic = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    ctx.content.start();
    await ctx.content.idle();
    expect(ctx.content.status(project.id, resource.id)?.status).toBe("pending");
    expect(extract).not.toHaveBeenCalled();
    expect(diagnostic).toHaveBeenCalledOnce();
    ctx.content.notify(project.id, resource.id);
    await ctx.content.idle();
    expect(diagnostic).toHaveBeenCalledOnce();
  } finally {
    diagnostic.mockRestore();
  }
});

it("keeps SQLite open until active extractor cleanup finishes during application disposal", async () => {
  const entered = Promise.withResolvers<void>();
  const cleaning = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const { ctx, path, resource, project } = await fixture({ extractor: async (_path, signal) => {
    entered.resolve();
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    cleaning.resolve();
    await release.promise;
    signal.throwIfAborted();
    return ready();
  } });
  ctx.content.start();
  await entered.promise;
  const settled = vi.fn();
  const disposal = ctx.fiber.dispose().then(settled);
  await cleaning.promise;
  expect(settled).not.toHaveBeenCalled();
  const db = new DatabaseSync(path, { readOnly: true });
  try {
    expect(db.prepare("SELECT status, processing_attempt_id FROM resource_content WHERE project_id = ? AND resource_id = ?")
      .get(project.id, resource.id)).toEqual({ status: "pending", processing_attempt_id: null });
  } finally { db.close(); }
  release.resolve();
  await disposal;
  const restored = await openContent(path);
  restored.content.start();
  await restored.content.idle();
  expect(restored.content.read(project.id, resource.id)?.body).toBe("# Original\n");
});
