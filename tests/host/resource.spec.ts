import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { StreamRpcRouter } from "../../rpc/stream/router.js";
import { createResourceId } from "../../src/brand/ids.js";
import { registerResourceMethods } from "../../src/host/resource.js";
import { fixture } from "../resource/assets/helpers.js";

it("exposes library management through versioned Host methods without bypassing the user service", async () => {
  const { ctx, path, project } = await fixture();
  const router = new StreamRpcRouter();
  registerResourceMethods(router, ctx);
  expect((await invoke(router, "resource.folder.create.v1", { projectId: project.id, path: "papers" }))[0])
    .toEqual({ path: "papers", explicit: true });

  const source = join(dirname(path), "selected.md");
  await writeFile(source, "# selected\n");
  const imported = await invoke(router, "resource.user-import.v1", { projectId: project.id,
    requestId: "host_import", sources: [{ kind: "file", path: source }] });
  expect(imported[0]).toMatchObject({ status: "saved", libraryPath: "selected.md" });
  const resourceId = (imported[0] as { resourceId: string }).resourceId;

  const updated = (await invoke(router, "resource.update.v1", { projectId: project.id, resourceId,
    expectedRevision: 1, name: "renamed.md", folder: "papers", description: "Evidence" }))[0] as {
      revision: number; libraryPath: string; description: string;
    };
  expect(updated).toMatchObject({ revision: 3, libraryPath: "papers/renamed.md", description: "Evidence" });
  await expect(invoke(router, "resource.update.v1", { projectId: project.id, resourceId,
    expectedRevision: 1, description: "stale" })).rejects.toMatchObject({ failure: { code: "revision-conflict" } });

  const replacement = join(dirname(path), "replacement.bin");
  await writeFile(replacement, Buffer.from([0, 1, 2, 3]));
  const replaced = (await invoke(router, "resource.replace.v1", { projectId: project.id, resourceId,
    expectedRevision: updated.revision, operationId: "host_replace", sourcePath: replacement }))[0] as {
      revision: number; assetGeneration: number; owner: unknown; libraryPath: string;
    };
  expect(replaced).toMatchObject({ revision: 4, assetGeneration: 2, owner: { kind: "user" },
    libraryPath: "papers/renamed.md" });

  const browse = (await invoke(router, "resource.library.browse.v1", { projectId: project.id, path: "papers" }))[0] as {
    resources: Array<{ resourceId: string }>;
  };
  expect(browse.resources.map(resource => resource.resourceId)).toEqual([resourceId]);
  expect((await invoke(router, "resource.folder.delete.v1", { projectId: project.id, path: "papers",
    recursive: false, operationId: "host_folder_check" }))[0]).toMatchObject({ status: "confirmation-required" });

  expect((await invoke(router, "resource.delete.v1", { projectId: project.id, resourceId,
    expectedRevision: replaced.revision, operationId: "host_delete" }))[0])
    .toEqual({ resourceId, deleted: true });
  expect((await invoke(router, "resource.folder.delete.v1", { projectId: project.id, path: "papers",
    recursive: true, operationId: "host_folder_delete" }))[0]).toMatchObject({ status: "deleted" });
});

it("follows library and content status changes and ends on cancellation", async () => {
  const { ctx, path, project } = await fixture();
  const router = new StreamRpcRouter();
  registerResourceMethods(router, ctx);
  const sourceRoot = join(dirname(path), "follow-source");
  await mkdir(sourceRoot);
  const source = join(sourceRoot, "note.unknown");
  await writeFile(source, "content");
  const imported = await invoke(router, "resource.user-import.v1", { projectId: project.id,
    requestId: "follow_import", sources: [{ kind: "file", path: source }] });
  const resourceId = (imported[0] as { resourceId: string }).resourceId;
  await ctx.content.idle();

  const controller = new AbortController();
  const registered = router.resolve("resource.library.follow.v1")!;
  const iterator = registered.handler({ projectId: project.id, path: null }, controller.signal)[Symbol.asyncIterator]();
  const baseline = (await iterator.next()).value as { resources: Array<{ content: { status: string } | null }> };
  expect(baseline.resources[0]?.content?.status).toBe("metadata_only");
  ctx.content.retry(project.id, createResourceId(resourceId));
  const pending = (await iterator.next()).value as { resources: Array<{ content: { status: string } | null }> };
  expect(["pending", "processing"]).toContain(pending.resources[0]?.content?.status);
  await ctx.content.idle();
  let final = pending;
  for (let index = 0; index < 3 && final.resources[0]?.content?.status !== "metadata_only"; index += 1) {
    final = (await iterator.next()).value as typeof final;
  }
  expect(final.resources[0]?.content?.status).toBe("metadata_only");
  controller.abort();
  expect((await iterator.next()).done).toBe(true);
});

async function invoke(router: StreamRpcRouter, name: string, input: unknown): Promise<unknown[]> {
  const registered = router.resolve(name)!;
  const parsed = registered.method.parseInput(input);
  const values: unknown[] = [];
  for await (const value of registered.handler(parsed, new AbortController().signal)) {
    values.push(registered.method.parseOutput(value));
  }
  return values;
}
