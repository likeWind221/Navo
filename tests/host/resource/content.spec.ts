import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "cordis";
import { expect, it, vi } from "vitest";

import { resourceContentRetryMethod, resourceLibraryFollowMethod } from "../../../rpc/resource.js";
import { registerResourceMethods } from "../../../src/host/resource.js";
import { UserResourceService } from "../../../src/resource/user.js";
import { ContentError } from "../../../src/resource/content/errors.js";
import { StreamRpcRouter } from "../../../rpc/stream/router.js";
import { fixture, ready } from "../../resource/content/fixture.js";

it("accepts a failed retry, emits follow updates, and reports the real terminal result", async () => {
  const extract = vi.fn(async () => {
    if (extract.mock.calls.length === 1) throw new ContentError("empty_content");
    return ready("recovered");
  });
  const { ctx, project, resource } = await fixture({ extractor: extract });
  await ctx.plugin(UserResourceService);
  ctx.content.start();
  await ctx.content.idle();
  expect(ctx.content.status(project.id, resource.id)).toMatchObject({ status: "failed", error_code: "empty_content" });

  const router = register(ctx);
  const controller = new AbortController();
  const follow = router.resolve(resourceLibraryFollowMethod.name)!;
  const iterator = follow.handler({ projectId: project.id, path: null }, controller.signal)[Symbol.asyncIterator]();
  const baseline = (await iterator.next()).value as { resources: Array<{ content: { status: string } | null }> };
  expect(baseline.resources[0]?.content?.status).toBe("failed");

  const accepted = (await invoke(router, {
    projectId: project.id, resourceId: resource.id, expectedRevision: resource.revision,
  }))[0]!;
  expect(accepted).toMatchObject({ projectId: project.id, resourceId: resource.id,
    revision: resource.revision, assetGeneration: resource.assetGeneration,
    status: "accepted", contentStatus: "pending" });
  const queued = (await iterator.next()).value as typeof baseline;
  expect(["pending", "processing"]).toContain(queued.resources[0]?.content?.status);

  await ctx.content.idle();
  let final = (await iterator.next()).value as typeof baseline;
  for (let index = 0; index < 3 && final.resources[0]?.content?.status !== "ready"; index += 1) {
    final = (await iterator.next()).value as typeof baseline;
  }
  expect(final.resources[0]?.content?.status).toBe("ready");
  expect(ctx.content.read(project.id, resource.id)?.body).toBe("recovered");
  expect(extract).toHaveBeenCalledTimes(2);
  controller.abort();
  expect((await iterator.next()).done).toBe(true);
});

it("rejects retries for a non-failed current content state", async () => {
  const { ctx, project, resource } = await fixture({ extractor: async () => ready() });
  await ctx.plugin(UserResourceService);
  ctx.content.start();
  await ctx.content.idle();
  const router = register(ctx);

  await expect(invoke(router, { projectId: project.id, resourceId: resource.id, expectedRevision: resource.revision }))
    .rejects.toMatchObject({ failure: { code: "operation-conflict" }, message: expect.stringContaining("ready") });
});

it("persists a failed terminal result when explicit retry fails again", async () => {
  const extract = vi.fn(async () => { throw new ContentError("empty_content"); });
  const { ctx, project, resource } = await fixture({ extractor: extract });
  await ctx.plugin(UserResourceService);
  ctx.content.start();
  await ctx.content.idle();
  const router = register(ctx);
  await expect(invoke(router, { projectId: project.id, resourceId: resource.id, expectedRevision: resource.revision }))
    .resolves.toMatchObject([{ status: "accepted", contentStatus: "pending" }]);
  await ctx.content.idle();
  expect(ctx.content.status(project.id, resource.id)).toMatchObject({
    status: "failed", error_code: "empty_content", body: null,
  });
  expect(extract).toHaveBeenCalledTimes(2);
});

it("distinguishes stale revision, replacement, and deletion before retry", async () => {
  const stale = await failedFixture();
  const staleRouter = register(stale.ctx);
  const staleRevision = stale.resource.revision;
  stale.ctx.resources.update({ projectId: stale.project.id, resourceId: stale.resource.id,
    actor: { kind: "main" }, expectedRevision: staleRevision, changes: { description: "changed" } });
  await expect(invoke(staleRouter, { projectId: stale.project.id, resourceId: stale.resource.id,
    expectedRevision: staleRevision })).rejects.toMatchObject({ failure: { code: "revision-conflict" } });

  const replaced = await failedFixture();
  const replacement = join(replaced.root, "replacement.md");
  await writeFile(replacement, "replacement");
  const current = await replaced.ctx.userResources.replace({ projectId: replaced.project.id,
    resourceId: replaced.resource.id, expectedRevision: replaced.resource.revision, operationId: "content-retry-replace" }, replacement);
  const replacedRouter = register(replaced.ctx);
  await expect(invoke(replacedRouter, { projectId: replaced.project.id, resourceId: replaced.resource.id,
    expectedRevision: current.revision })).rejects.toMatchObject({
      failure: { code: "operation-conflict" }, message: expect.stringContaining("pending"),
    });

  const deleted = await failedFixture();
  await deleted.ctx.userResources.delete({ projectId: deleted.project.id, resourceId: deleted.resource.id,
    expectedRevision: deleted.resource.revision, operationId: "content-retry-delete" });
  const deletedRouter = register(deleted.ctx);
  await expect(invoke(deletedRouter, { projectId: deleted.project.id, resourceId: deleted.resource.id,
    expectedRevision: deleted.resource.revision })).rejects.toMatchObject({ failure: { code: "resource-unavailable" } });
});

async function failedFixture() {
  const extract = vi.fn(async () => { throw new ContentError("empty_content"); });
  const state = await fixture({ extractor: extract });
  await state.ctx.plugin(UserResourceService);
  state.ctx.content.start();
  await state.ctx.content.idle();
  expect(state.ctx.content.status(state.project.id, state.resource.id)?.status).toBe("failed");
  return state;
}

function register(ctx: Context) {
  const router = new StreamRpcRouter();
  registerResourceMethods(router, ctx);
  expect(router.resolve(resourceContentRetryMethod.name)).toBeDefined();
  return router;
}

async function invoke(router: ReturnType<typeof register>, input: unknown) {
  const registered = router.resolve(resourceContentRetryMethod.name)!;
  const parsed = registered.method.parseInput(input);
  const values = [];
  for await (const value of registered.handler(parsed, new AbortController().signal)) {
    values.push(resourceContentRetryMethod.parseOutput(value));
  }
  return values;
}
