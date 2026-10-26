import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Context } from "cordis";
import { expect, it } from "vitest";

import { resourceViewCopyMethod } from "../../../rpc/resource/view.js";
import { registerResourceMethods } from "../../../src/host/resource.js";
import { StreamRpcRouter } from "../../../rpc/stream/router.js";
import { fixture } from "../../resource/assets/helpers.js";

it("creates a readable independent copy through the registered Host method", async () => {
  const { ctx, project, input, workspace, root } = await fixture();
  const router = register(ctx);
  const resource = await ctx.resources.publish(input);
  const copy = (await invoke(router, { projectId: project.id, resourceId: String(resource.id), expectedRevision: resource.revision }))[0]!;
  const sourcePath = join(workspace.assetsRoot, String(resource.id), resource.entryRef);

  expect(copy).toMatchObject({
    projectId: project.id,
    resourceId: String(resource.id),
    revision: resource.revision,
    assetGeneration: resource.assetGeneration,
  });
  expect(copy.copyPath).not.toBe(sourcePath);
  expect(await readFile(copy.copyPath, "utf8")).toBe("generation one");
  await writeFile(copy.copyPath, "edited outside Navo");
  expect(await readFile(copy.copyPath, "utf8")).toBe("edited outside Navo");
  expect(await readFile(sourcePath, "utf8")).toBe("generation one");

  const replacement = join(root, "replacement.md");
  await writeFile(replacement, "generation two");
  await ctx.userResources.replace({ projectId: project.id, resourceId: resource.id,
    expectedRevision: resource.revision, operationId: "view-copy-replace" }, replacement);
  expect(await readFile(copy.copyPath, "utf8")).toBe("edited outside Navo");
  await ctx.userResources.delete({ projectId: project.id, resourceId: resource.id,
    expectedRevision: resource.revision + 1, operationId: "view-copy-delete" });
  expect(await readFile(copy.copyPath, "utf8")).toBe("edited outside Navo");
});

it("enforces current revision and project ownership", async () => {
  const { ctx, project, input } = await fixture();
  const router = register(ctx);
  const resource = await ctx.resources.publish(input);
  ctx.resources.update({ projectId: project.id, resourceId: resource.id, actor: { kind: "main" },
    expectedRevision: resource.revision, changes: { description: "changed" } });
  await expect(invoke(router, { projectId: project.id, resourceId: String(resource.id), expectedRevision: resource.revision }))
    .rejects.toMatchObject({ failure: { code: "revision-conflict" } });

  const other = ctx.projects.create({ name: "Other", goal: null });
  await expect(invoke(router, { projectId: String(other.id), resourceId: String(resource.id), expectedRevision: 2 }))
    .rejects.toMatchObject({ failure: { code: "resource-unavailable" } });
});

it("cancels before copying and does not create a result", async () => {
  const { ctx, project, input } = await fixture();
  const router = register(ctx);
  const resource = await ctx.resources.publish(input);
  const registered = router.resolve(resourceViewCopyMethod.name)!;
  const controller = new AbortController();
  controller.abort();
  await expect(registered.handler({ projectId: project.id, resourceId: String(resource.id), expectedRevision: resource.revision }, controller.signal)
    [Symbol.asyncIterator]().next()).rejects.toMatchObject({ name: "AbortError" });
});

function register(ctx: Context) {
  const router = new StreamRpcRouter();
  registerResourceMethods(router, ctx);
  expect(router.resolve(resourceViewCopyMethod.name)).toBeDefined();
  return router;
}

async function invoke(router: ReturnType<typeof register>, input: unknown): Promise<Array<{ readonly copyPath: string }>> {
  const registered = router.resolve(resourceViewCopyMethod.name)!;
  const parsed = registered.method.parseInput(input);
  const values: Array<{ readonly copyPath: string }> = [];
  for await (const value of registered.handler(parsed, new AbortController().signal)) {
    values.push(resourceViewCopyMethod.parseOutput(value));
  }
  return values;
}
