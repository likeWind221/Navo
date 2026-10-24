import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, close, fixture, open, adapter, publish, settle } from "../graph/fixture.js";
import { createApp } from "../../../src/app.js";
import { contexts } from "../graph/fixture.js";

afterEach(cleanup);

describe("Scoped hybrid retrieval", () => {
  it("finds English words, Chinese substrings and single Han characters without interpreting MATCH operators", async () => {
    const { ctx, project, workspace } = await fixture();
    const english = await publish(ctx, project.id, workspace, "english.md", "Transformer attention evidence.");
    const chinese = await publish(ctx, project.id, workspace, "chinese.md", "研究知识图谱检索以及中文资料。");
    const search = (query: string) => ctx.retrieval.search({ projectId: project.id, viewer: { kind: "main" }, mode: "keyword", query });
    expect((await search("ATTENTION")).map(hit => hit.resourceId)).toEqual([english.id]);
    expect((await search("图谱")).map(hit => hit.resourceId)).toEqual([chinese.id]);
    expect((await search("谱")).map(hit => hit.resourceId)).toEqual([chinese.id]);
    expect((await search('"attention" OR unknown:*')).map(hit => hit.resourceId)).toEqual([english.id]);
    expect(await search("nonexistent")).toEqual([]);
    expect(await search("!!!")).toEqual([]);
  });

  it("groups repeated matching chunks by Resource and honors descendant folders and explicit Resource scope", async () => {
    const { ctx, project, workspace } = await fixture();
    const resource = await publish(ctx, project.id, workspace, "long.md", Array.from({ length: 25 }, (_, n) =>
      `Section ${n}: apple evidence ${"additional context ".repeat(35)}`).join("\n\n"));
    const other = await publish(ctx, project.id, workspace, "other.md", "apple evidence");
    ctx.resources.createUserFolder(project.id, "Papers");
    ctx.resources.createUserFolder(project.id, "Papers/Sub");
    ctx.resources.organizeUserResource({ projectId: project.id, resourceId: resource.id, expectedRevision: resource.revision, folder: "Papers/Sub" });
    const request = { projectId: project.id, viewer: { kind: "main" } as const, query: "apple", mode: "keyword" as const };
    const results = await ctx.retrieval.search({ ...request, folder: "papers" });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ resourceId: resource.id, libraryPath: "Papers/Sub/long.md" });
    expect(results[0]!.chunks.length).toBeGreaterThan(1);
    expect(results[0]!.chunks.length).toBeLessThanOrEqual(5);
    expect(new Set(results[0]!.chunks.map(chunk => chunk.chunkId)).size).toBe(results[0]!.chunks.length);
    const body = ctx.content.read(project.id, resource.id)!.body!;
    expect(results[0]!.chunks.every(chunk => body.slice(chunk.startOffsetUtf16, chunk.endOffsetUtf16) === chunk.text)).toBe(true);
    expect((await ctx.retrieval.search({ ...request, resourceIds: [other.id] })).map(hit => hit.resourceId)).toEqual([other.id]);
    expect(await ctx.retrieval.search({ ...request, resourceIds: [] })).toEqual([]);
    expect(await ctx.retrieval.search({ ...request, folder: "Paper" })).toEqual([]);
  });

  it("keeps keyword scores and results independent of private and other-project corpora", async () => {
    const { ctx, project, workspace, root } = await fixture();
    const node = ctx.nodes.create({ projectId: project.id, objective: { title: "Reader", description: "Read", acceptanceCriteria: ["Read"] } });
    const shared = await publish(ctx, project.id, workspace, "shared.md", "apple evidence");
    ctx.resources.setAccess({ projectId: project.id, resourceId: shared.id, actor: { kind: "main" },
      expectedRevision: shared.revision, access: { kind: "public" } });
    const request = { projectId: project.id, viewer: { kind: "node", nodeId: node.node.id } as const, query: "apple", mode: "keyword" as const };
    const before = await ctx.retrieval.search(request);
    await publish(ctx, project.id, workspace, "secret.md", "apple apple secret evidence");
    const other = ctx.projects.create({ name: "Other", goal: null });
    await mkdir(join(root, "other"));
    await ctx.projectWorkspaces.create(other.id, join(root, "other"));
    await publish(ctx, other.id, join(root, "other"), "foreign.md", "apple secret foreign");
    expect(await ctx.retrieval.search(request)).toEqual(before);
    expect(JSON.stringify(await ctx.retrieval.search({ ...request, mode: "hybrid" }))).not.toContain("secret");
  });

  it("returns current evidence after a replacement while vector retrieval was pending, and excludes deleted sources", async () => {
    const { ctx, project, workspace } = await fixture();
    const resource = await publish(ctx, project.id, workspace, "old.md", "old apple evidence");
    await writeFile(join(workspace, "new.md"), "new banana evidence");
    const original = ctx.indexSearch.search.bind(ctx.indexSearch);
    vi.spyOn(ctx.indexSearch, "search").mockImplementationOnce(async request => {
      const hits = await original(request);
      await ctx.resources.replace({ projectId: project.id, resourceId: resource.id, actor: { kind: "main" },
        expectedRevision: resource.revision, sourceRef: "new.md" });
      await settle(ctx);
      return hits;
    });
    const request = { projectId: project.id, viewer: { kind: "main" } as const, query: "apple" };
    const result = await ctx.retrieval.search(request);
    expect(JSON.stringify(result)).not.toContain("old apple");
    const current = ctx.resources.get(project.id, resource.id)!;
    const banana = await ctx.retrieval.search({ ...request, query: "banana", mode: "keyword" });
    expect(banana[0]).toMatchObject({ assetGeneration: current.assetGeneration });
    expect(banana[0]!.chunks[0]!.text).toBe("new banana evidence");
    await ctx.resources.delete({ projectId: project.id, resourceId: resource.id, actor: { kind: "main" }, expectedRevision: current.revision });
    expect(await ctx.retrieval.search({ ...request, query: "banana" })).toEqual([]);
  });

  it("rechecks revoked access after the asynchronous vector call", async () => {
    const { ctx, project, workspace } = await fixture();
    const node = ctx.nodes.create({ projectId: project.id, objective: { title: "Reader", description: "Read", acceptanceCriteria: ["Read"] } });
    const resource = await publish(ctx, project.id, workspace);
    const shared = ctx.resources.setAccess({ projectId: project.id, resourceId: resource.id, actor: { kind: "main" },
      expectedRevision: resource.revision, access: { kind: "public" } });
    const original = ctx.indexSearch.search.bind(ctx.indexSearch);
    vi.spyOn(ctx.indexSearch, "search").mockImplementationOnce(async request => {
      const hits = await original(request);
      ctx.resources.setAccess({ projectId: project.id, resourceId: resource.id, actor: { kind: "main" },
        expectedRevision: shared.revision, access: { kind: "private" } });
      return hits;
    });
    expect(await ctx.retrieval.search({ projectId: project.id, viewer: { kind: "node", nodeId: node.node.id }, query: "Alice" })).toEqual([]);
  });

  it("rejects cancellation before and after the embedding call", async () => {
    const { ctx, project, workspace } = await fixture();
    await publish(ctx, project.id, workspace);
    const controller = new AbortController();
    const original = ctx.indexSearch.search.bind(ctx.indexSearch);
    const spy = vi.spyOn(ctx.indexSearch, "search").mockImplementationOnce(async request => {
      const hits = await original(request);
      controller.abort();
      return hits;
    });
    const request = { projectId: project.id, viewer: { kind: "main" } as const, query: "Alice", signal: controller.signal };
    await expect(ctx.retrieval.search(request)).rejects.toMatchObject({ name: "AbortError" });
    await expect(ctx.retrieval.search(request)).rejects.toMatchObject({ name: "AbortError" });
    expect(spy).toHaveBeenCalledOnce();
  });

  it("rebuilds scoped keyword search from persisted chunks after reopening", async () => {
    const { ctx, project, workspace, path } = await fixture(undefined, { persistent: true });
    await publish(ctx, project.id, workspace, "persist.md", "persistent apple evidence");
    const request = { projectId: project.id, viewer: { kind: "main" } as const, query: "apple", mode: "keyword" as const };
    const before = await ctx.retrieval.search(request);
    await close(ctx);
    const reopened = await open(path, adapter());
    await settle(reopened);
    expect(await reopened.retrieval.search(request)).toEqual(before);
  });

  it("supports persisted keyword retrieval without an embedding provider and explicitly rejects hybrid retrieval", async () => {
    const { ctx, project, workspace, path } = await fixture(undefined, { persistent: true });
    const resource = await publish(ctx, project.id, workspace, "persist.md", "persistent apple evidence");
    await close(ctx);
    const reopened = await createApp({ storage: { path }, node: { session: { model: { provider: "mock", model: "test" } } } });
    contexts.push(reopened);
    const request = { projectId: project.id, viewer: { kind: "main" } as const, query: "apple" };
    expect((await reopened.retrieval.search({ ...request, mode: "keyword" }))[0]!.resourceId).toBe(resource.id);
    await expect(reopened.retrieval.search(request)).rejects.toMatchObject({ code: "embedding-unconfigured" });
  });

  it.each([{ query: " " }, { query: "x".repeat(4097) }, { topK: 0 }, { maxHops: 4 }])("rejects invalid query options %j", async options => {
    const { ctx, project } = await fixture();
    await expect(ctx.retrieval.search({ projectId: project.id, viewer: { kind: "main" }, query: "Alice", ...options }))
      .rejects.toMatchObject({ code: "invalid-query" });
  });
});
