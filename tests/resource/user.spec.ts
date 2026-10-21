import { mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { createProjectId } from "../../src/brand/ids.js";
import { parseResourceHistory } from "../../src/resource/history.js";
import { registerResourceMethods } from "../../src/host/resource.js";
import { StreamRpcRouter } from "../../rpc/stream/router.js";
import { userImportMethod } from "../../rpc/resource.js";
import { describeResource } from "../../src/host/project/view.js";
import { parseProjectResources } from "../../rpc/project/validation.js";
import { fixture, operation } from "./assets/helpers.js";

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const items: T[] = [];
  for await (const value of values) items.push(value);
  return items;
}

it("imports nested and repeated user files as public Resources and starts content processing", async () => {
  const { ctx, path, project, workspace } = await fixture();
  const selected = join(dirname(path), "selected");
  await mkdir(join(selected, "chapter"), { recursive: true });
  await writeFile(join(selected, "chapter", "note.md"), "# User evidence\n");
  const input = { projectId: project.id, requestId: "userbatch", sources: [
    { kind: "directory" as const, path: selected },
    { kind: "file" as const, path: join(selected, "chapter", "note.md") },
  ] };
  const results = await collect(ctx.userResources.import(input, new AbortController().signal));
  expect(results.map(item => item.status)).toEqual(["saved", "saved"]);
  const saved = results.filter(item => item.status === "saved");
  expect(saved.map(item => item.libraryPath)).toEqual(["chapter/note.md", "note.md"]);
  const first = ctx.resources.listByProject(project.id)[0]!;
  expect(first).toMatchObject({ owner: { kind: "user" }, access: { kind: "public" }, description: "" });
  expect(ctx.resources.getEvents(project.id)[0]).toMatchObject({ data: { access: { kind: "public" } } });
  expect(parseResourceHistory(ctx, project.id, ctx.resources.getEvents(project.id))).toHaveLength(2);
  expect(parseProjectResources({ resources: [describeResource(first)] }).resources[0]?.owner).toEqual({ kind: "user" });
  const node = ctx.nodes.create({ projectId: project.id,
    objective: { title: "Reader", description: "Read", acceptanceCriteria: ["Read"] } });
  expect(ctx.resources.getVisible(project.id, first.id, { kind: "node", nodeId: node.node.id })).toEqual(first);
  const other = ctx.projects.create({ name: "Other", goal: null });
  expect(() => ctx.resources.getVisible(other.id, first.id, { kind: "main" }))
    .toThrow(expect.objectContaining({ code: "resource-unavailable" }));
  expect(operation(ctx, `${project.id}_userbatch_0`).request_json).not.toContain(selected);
  expect(await readFile(join(workspace.assetsRoot, first.id, first.entryRef), "utf8")).toBe("# User evidence\n");
  await ctx.content.idle();
  expect(ctx.content.status(project.id, first.id)?.status).toBe("ready");
  const replay = await collect(ctx.userResources.import(input, new AbortController().signal));
  expect(replay).toEqual(results.map((item, index) => index === 0 && item.status === "saved"
    ? { ...item, contentStatus: "ready" } : item.status === "saved" ? { ...item, contentStatus: "ready" } : item));
  expect(ctx.resources.getEvents(project.id)).toHaveLength(2);
});

it("keeps Agent mutation separate from User management without changing owner", async () => {
  const { ctx, input, path, project } = await fixture();
  const agent = await ctx.resources.publish(input);
  const selected = join(dirname(path), "replacement.txt");
  await writeFile(selected, "replacement");
  expect(() => ctx.resources.update({ projectId: project.id, resourceId: agent.id,
    actor: { kind: "user" }, expectedRevision: 1, changes: { description: "blocked" } }))
    .toThrow(expect.objectContaining({ code: "node-unavailable" }));
  const updated = ctx.userResources.update({ projectId: project.id, resourceId: agent.id,
    expectedRevision: 1, changes: { description: "" } });
  expect(updated).toMatchObject({ owner: { kind: "main" }, description: "", revision: 2 });
  const replaced = await ctx.userResources.replace({ projectId: project.id, resourceId: agent.id,
    expectedRevision: 2, operationId: "userreplace" }, selected);
  expect(replaced).toMatchObject({ owner: { kind: "main" }, assetGeneration: 2 });
  expect(operation(ctx, "userreplace").request_json).not.toContain(selected);
  await ctx.userResources.delete({ projectId: project.id, resourceId: agent.id,
    expectedRevision: 3, operationId: "userdelete" });
  expect(ctx.resources.get(project.id, agent.id)).toBeUndefined();
});

it("returns per-file failures and cancellation without rolling back saved files", async () => {
  const { ctx, path, project } = await fixture();
  const selected = join(dirname(path), "chosen");
  await mkdir(selected);
  const good = join(selected, "good.txt");
  await writeFile(good, "good");
  const missing = join(selected, "missing.txt");
  const controller = new AbortController();
  const input = { projectId: project.id, requestId: "partial", sources: [
    { kind: "file" as const, path: good },
    { kind: "file" as const, path: missing },
    { kind: "file" as const, path: good },
  ] };
  const items = ctx.userResources.import(input, controller.signal);
  expect((await items.next()).value?.status).toBe("saved");
  expect((await items.next()).value).toMatchObject({ status: "failed", code: "invalid-source" });
  controller.abort();
  expect((await items.next()).value?.status).toBe("cancelled");
  expect(ctx.resources.listByProject(project.id)).toHaveLength(1);
});

it("rejects symbolic links and arbitrary user owner from the Agent publish path", async () => {
  const { ctx, path, project, root } = await fixture();
  const selected = join(dirname(path), "linked");
  await symlink(root, selected, "junction");
  const result = await collect(ctx.userResources.import({ projectId: project.id,
    requestId: "linked", sources: [{ kind: "directory", path: selected }] }, new AbortController().signal));
  expect(result[0]).toMatchObject({ status: "failed", code: "invalid-source" });
  await expect(ctx.resources.publish({ ...({ projectId: project.id, owner: { kind: "user" as const },
    sourceRef: "report.md", name: "No", description: "", type: "text/markdown" }) }))
    .rejects.toMatchObject({ code: "node-unavailable" });
  expect(ctx.resources.listByProject(project.id)).toHaveLength(0);
});

it("strictly parses the RPC contract and exposes it only through the Host registration", async () => {
  const { ctx, path, project } = await fixture();
  const selected = join(dirname(path), "rpc.txt");
  await writeFile(selected, "RPC");
  const input = { projectId: project.id, requestId: "rpc", sources: [{ kind: "file" as const, path: selected }] };
  expect(() => userImportMethod.parseInput({ ...input, actor: { kind: "user" } })).toThrow();
  expect(() => userImportMethod.parseInput({ ...input, sources: [{ kind: "file", path: selected, owner: "user" }] })).toThrow();
  const router = new StreamRpcRouter();
  registerResourceMethods(router, ctx);
  const method = router.resolve("resource.user-import.v1")!;
  const output = await collect(method.handler(input, new AbortController().signal));
  expect(userImportMethod.parseOutput(output[0])).toMatchObject({ status: "saved", contentStatus: "pending" });
  await rm(selected);
  const replay = await collect(method.handler(input, new AbortController().signal));
  expect(replay[0]).toMatchObject({ status: "saved", resourceId: (output[0] as { resourceId: string }).resourceId });
  expect(router.resolve("resource.user-import.v2")).toBeUndefined();
  expect(ctx.resources.listByProject(createProjectId(input.projectId))).toHaveLength(1);
});

it("does not persist the absolute source path when user staging fails", async () => {
  const { ctx, path, project } = await fixture();
  const selected = join(dirname(path), "sensitive-local-source.md");
  await expect(ctx.resources.importUser({ projectId: project.id, operationId: "privatepath",
    sourceRef: "user-intake/privatepath/source.md", libraryPath: "source.md",
    name: "source.md", description: "", type: "text/markdown" },
  { filename: "source.md", receive: async () => ({ path: selected }) })).rejects.toThrow();
  expect(operation(ctx, "privatepath").error_code).toBe("asset-write-failed");
  expect(operation(ctx, "privatepath").request_json).not.toContain(selected);
});
