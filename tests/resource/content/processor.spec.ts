import { stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { ContentError } from "../../../src/resource/content/errors.js";
import { CONTENT_LIMITS } from "../../../src/resource/content/extraction.js";
import { pendingContent, ResourceContentStore } from "../../../src/resource/content/store.js";
import { rawSql } from "../../helpers/storage.js";
import { fixture, openContent, ready } from "./fixture.js";

it("publishes text without awaiting extraction, deduplicates triggers and reuses ready after metadata changes", async () => {
  const extract = vi.fn(async () => ready());
  const { ctx, resource, project } = await fixture({ extractor: extract });
  expect(ctx.content.status(project.id, resource.id)?.status).toBe("pending");
  ctx.content.start();
  for (let index = 0; index < 10; index++) ctx.content.notify(project.id, resource.id);
  await ctx.content.idle();
  expect(ctx.content.read(project.id, resource.id)).toMatchObject({ body: "body", source_asset_generation: 1, processing_attempt_id: null });
  ctx.resources.update({ projectId: project.id, resourceId: resource.id, actor: { kind: "main" }, expectedRevision: 1, changes: { name: "Renamed" } });
  ctx.content.notify(project.id, resource.id);
  await ctx.content.idle();
  expect(extract).toHaveBeenCalledOnce();
});

it("does not lose a retry arriving between the last pending scan and worker completion", async () => {
  const extract = vi.fn(async () => extract.mock.calls.length === 1 ? { status: "metadata_only" as const } : ready());
  const { ctx, project, resource } = await fixture({ extractor: extract });
  const pending = ResourceContentStore.prototype.pending;
  let requested = false;
  const scan = vi.spyOn(ResourceContentStore.prototype, "pending").mockImplementation(function (this: ResourceContentStore) {
    const rows = pending.call(this);
    if (rows.length === 0 && !requested) {
      requested = true;
      queueMicrotask(() => ctx.content.retry(project.id, resource.id));
    }
    return rows;
  });
  try {
    ctx.content.start();
    await ctx.content.idle();
    expect(extract).toHaveBeenCalledTimes(2);
    expect(ctx.content.read(project.id, resource.id)?.body).toBe("body");
  } finally { scan.mockRestore(); }
});

it("serializes work and refuses duplicate claims while a task is processing", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const extract = vi.fn(async () => { entered.resolve(); await release.promise; return ready(); });
  const { ctx, resource, project, root, input } = await fixture({ extractor: extract });
  ctx.content.start();
  await entered.promise;
  await writeFile(join(root, "next.txt"), "next");
  const next = await ctx.resources.publish({ ...input, sourceRef: "next.txt" });
  ctx.content.notify(project.id, resource.id);
  expect(ctx.content.status(project.id, resource.id)?.status).toBe("processing");
  expect(ctx.content.status(project.id, next.id)?.status).toBe("pending");
  expect(extract).toHaveBeenCalledOnce();
  release.resolve();
  await ctx.content.idle();
  expect(extract).toHaveBeenCalledTimes(2);
});

it.each(["empty_content", "pdf_parse_failed", "content_limit_exceeded", "page_limit_exceeded"] as const)("does not auto-retry %s across triggers or restart, but explicit retry uses a fresh attempt", async code => {
  const attempts: (string | null | undefined)[] = [];
  const extract = vi.fn(async () => {
    attempts.push(ctx.content.status(project.id, resource.id)?.processing_attempt_id);
    throw new ContentError(code);
  });
  const { ctx, path, project, resource } = await fixture({ extractor: extract });
  ctx.content.start();
  await ctx.content.idle();
  expect(ctx.content.status(project.id, resource.id)).toMatchObject({ status: "failed", body: null, error_code: code });
  ctx.content.notify(project.id, resource.id);
  await ctx.content.idle();
  expect(extract).toHaveBeenCalledOnce();
  ctx.content.retry(project.id, resource.id);
  await ctx.content.idle();
  expect(attempts[0]).not.toBe(attempts[1]);
  await ctx.fiber.dispose();
  const restoredExtract = vi.fn(async () => ready("restored"));
  const restored = await openContent(path, { extractor: restoredExtract });
  restored.content.start();
  await restored.content.idle();
  expect(restoredExtract).not.toHaveBeenCalled();
  restored.content.retry(project.id, resource.id);
  await restored.content.idle();
  expect(restored.content.read(project.id, resource.id)?.body).toBe("restored");
});

it("preserves metadata_only without reparsing until explicit retry", async () => {
  const extract = vi.fn(async () => ({ status: "metadata_only" as const }));
  const { ctx, project, resource } = await fixture({ extractor: extract });
  ctx.content.start();
  await ctx.content.idle();
  ctx.content.notify(project.id, resource.id);
  await ctx.content.idle();
  expect(ctx.content.status(project.id, resource.id)?.status).toBe("metadata_only");
  expect(extract).toHaveBeenCalledOnce();
  ctx.content.retry(project.id, resource.id);
  await ctx.content.idle();
  expect(extract).toHaveBeenCalledTimes(2);
});

it("pins the old asset during replacement, rejects its late body and publishes only the new generation", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const extract = vi.fn(async () => { entered.resolve(); await release.promise; return ready(extract.mock.calls.length === 1 ? "old" : "new"); });
  const { ctx, project, resource, root, workspace } = await fixture({ extractor: extract });
  ctx.content.start();
  await entered.promise;
  const old = join(workspace.assetsRoot, resource.id, resource.entryRef);
  await writeFile(join(root, "replacement.txt"), "new");
  await ctx.resources.replace({ projectId: project.id, resourceId: resource.id, actor: { kind: "main" }, expectedRevision: 1, sourceRef: "replacement.txt" });
  expect(ctx.content.read(project.id, resource.id)).toBeUndefined();
  expect(ctx.content.status(project.id, resource.id)).toMatchObject({ status: "pending", source_asset_generation: 2 });
  expect((await stat(old)).isFile()).toBe(true);
  release.resolve();
  await ctx.content.idle();
  expect(ctx.content.read(project.id, resource.id)).toMatchObject({ body: "new", source_asset_generation: 2 });
  await expect(stat(old)).rejects.toMatchObject({ code: "ENOENT" });
});

it("rejects stale ready immediately even if resetting the replacement content row fails", async () => {
  const { ctx, project, resource, root } = await fixture();
  ctx.content.start();
  await ctx.content.idle();
  const ensure = vi.spyOn(ctx.content, "notify").mockImplementation(() => {});
  await writeFile(join(root, "replacement.txt"), "new");
  await ctx.resources.replace({ projectId: project.id, resourceId: resource.id, actor: { kind: "main" }, expectedRevision: 1, sourceRef: "replacement.txt" });
  expect(ctx.storage.atomic(tx => tx.getResourceContent(project.id, resource.id))?.status).toBe("ready");
  expect(ctx.content.read(project.id, resource.id)).toBeUndefined();
  ensure.mockRestore();
});

it("deletes event and body atomically, rolls both back on failure, and rejects late extraction after deletion", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const { ctx, resource, project, path } = await fixture({ extractor: async () => { entered.resolve(); await release.promise; return ready(); } });
  ctx.content.start();
  await entered.promise;
  rawSql(path, "CREATE TRIGGER content_delete_failure BEFORE DELETE ON resource_content BEGIN SELECT RAISE(ABORT, 'delete failure'); END;");
  const input = { projectId: project.id, resourceId: resource.id, actor: { kind: "main" as const }, expectedRevision: 1 };
  expect(() => ctx.resources.delete(input)).toThrow();
  expect(ctx.resources.get(project.id, resource.id)).toEqual(resource);
  expect(ctx.storage.atomic(tx => tx.getResourceContent(project.id, resource.id))?.status).toBe("processing");
  rawSql(path, "DROP TRIGGER content_delete_failure;");
  await ctx.resources.delete(input);
  expect(ctx.storage.atomic(tx => tx.getResourceContent(project.id, resource.id))).toBeUndefined();
  release.resolve();
  await ctx.content.idle();
  expect(ctx.content.read(project.id, resource.id)).toBeUndefined();
  ctx.storage.atomic(tx => tx.putResourceContent({ ...pendingContent(project.id, resource.id, 1), ...{ status: "ready", body: "orphan", extractor_version: "test" } }));
  expect(ctx.content.read(project.id, resource.id)).toBeUndefined();
});

it.each(["cancelled", "timeout"])("records runtime %s as failed, releases lease and only retries explicitly", async code => {
  const entered = Promise.withResolvers<void>();
  const extract = vi.fn(async (_path: string, signal: AbortSignal) => {
    entered.resolve();
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    signal.throwIfAborted();
    return ready();
  });
  const { ctx, project, resource } = await fixture({ extractor: extract, limits: { ...CONTENT_LIMITS, timeoutMs: code === "timeout" ? 20 : 10000 } });
  ctx.content.start();
  await entered.promise;
  if (code === "cancelled") ctx.content.cancel();
  await ctx.content.idle();
  expect(ctx.content.status(project.id, resource.id)).toMatchObject({ status: "failed", error_code: code, body: null });
  ctx.content.notify(project.id, resource.id);
  await ctx.content.idle();
  expect(extract).toHaveBeenCalledOnce();
});

it("resets shutdown to pending before cleanup, waits for it and never drains another task", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const extract = vi.fn(async (_path: string, signal: AbortSignal) => {
    entered.resolve();
    await new Promise<void>(resolve => signal.addEventListener("abort", () => resolve(), { once: true }));
    await release.promise;
    signal.throwIfAborted();
    return ready();
  });
  const { ctx, project, resource, root, input } = await fixture({ extractor: extract });
  ctx.content.start();
  await entered.promise;
  await writeFile(join(root, "next.txt"), "next");
  await ctx.resources.publish({ ...input, sourceRef: "next.txt" });
  const settled = vi.fn();
  const stopping = ctx.content.stop().then(settled);
  expect(ctx.content.status(project.id, resource.id)).toMatchObject({ status: "pending", processing_attempt_id: null });
  await Promise.resolve();
  expect(settled).not.toHaveBeenCalled();
  release.resolve();
  await stopping;
  expect(extract).toHaveBeenCalledOnce();
});
