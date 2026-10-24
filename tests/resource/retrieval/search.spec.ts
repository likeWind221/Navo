import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, close, fixture, open, adapter, publish, settle } from "../graph/fixture.js";
import { createApp } from "../../../src/app.js";
import { contexts } from "../graph/fixture.js";

afterEach(cleanup);

describe("Scoped hybrid retrieval", () => {
  it("matches exact graph entity names without keyword or vector hits", async () => {
    const { ctx, project, workspace } = await fixture(chunks => ({ entities: [
      { id: "a", name: "Navo", type: "Project", chunkIds: [chunks[0]!.id] },
      { id: "b", name: "知识图谱", type: "Topic", chunkIds: [chunks[0]!.id] },
    ], relations: [] }));
    const resource = await publish(ctx, project.id, workspace, "entities.md", "Navo uses 知识图谱.");
    vi.spyOn(ctx.indexSearch, "search").mockResolvedValue([]);
    const search = (query: string) => ctx.retrieval.search({ projectId: project.id, viewer: { kind: "main" }, query });
    for (const query of ["What is NAVO?", "知识图谱如何使用？"]) {
      const hits = await search(query);
      expect(hits.map(hit => hit.resourceId)).toEqual([resource.id]);
      expect(hits[0]!.chunks[0]!.matches).toEqual(["entity"]);
    }
    expect(await search("Navos")).toEqual([]);
    expect(await search("nonexistent")).toEqual([]);
  });

  it("groups repeated matching chunks by Resource and honors descendant folders and explicit Resource scope", async () => {
    const { ctx, project, workspace } = await fixture();
    const resource = await publish(ctx, project.id, workspace, "long.md", Array.from({ length: 25 }, (_, n) =>
      `Section ${n}: apple evidence ${"additional context ".repeat(35)}`).join("\n\n"));
    const other = await publish(ctx, project.id, workspace, "other.md", "apple evidence");
    ctx.resources.createUserFolder(project.id, "Papers");
    ctx.resources.createUserFolder(project.id, "Papers/Sub");
    ctx.resources.organizeUserResource({ projectId: project.id, resourceId: resource.id, expectedRevision: resource.revision, folder: "Papers/Sub" });
    const request = { projectId: project.id, viewer: { kind: "main" } as const, query: "apple", mode: "vector" as const };
    const results = await ctx.retrieval.search({ ...request, folder: "papers" });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ resourceId: resource.id, libraryPath: "Papers/Sub/long.md" });
    expect(results[0]!.chunks.length).toBeGreaterThan(1);
    expect(results[0]!.chunks.length).toBeLessThanOrEqual(3);
    expect(new Set(results[0]!.chunks.map(chunk => chunk.chunkId)).size).toBe(results[0]!.chunks.length);
    const body = ctx.content.read(project.id, resource.id)!.body!;
    expect(results[0]!.chunks.every(chunk => body.slice(chunk.startOffsetUtf16, chunk.endOffsetUtf16) === chunk.text)).toBe(true);
    expect((await ctx.retrieval.search({ ...request, resourceIds: [other.id] })).map(hit => hit.resourceId)).toEqual([other.id]);
    expect(await ctx.retrieval.search({ ...request, resourceIds: [] })).toEqual([]);
    expect(await ctx.retrieval.search({ ...request, folder: "Paper" })).toEqual([]);
  });

  it("keeps vector and graph results independent of private and other-project corpora", async () => {
    const { ctx, project, workspace, root } = await fixture();
    const node = ctx.nodes.create({ projectId: project.id, objective: { title: "Reader", description: "Read", acceptanceCriteria: ["Read"] } });
    const shared = await publish(ctx, project.id, workspace, "shared.md", "apple evidence");
    ctx.resources.setAccess({ projectId: project.id, resourceId: shared.id, actor: { kind: "main" },
      expectedRevision: shared.revision, access: { kind: "public" } });
    const request = { projectId: project.id, viewer: { kind: "node", nodeId: node.node.id } as const, query: "apple", mode: "vector" as const };
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
    const banana = await ctx.retrieval.search({ ...request, query: "banana", mode: "vector" });
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

  it("retrieves the same evidence from persisted chunks after reopening", async () => {
    const { ctx, project, workspace, path } = await fixture(undefined, { persistent: true });
    await publish(ctx, project.id, workspace, "persist.md", "persistent apple evidence");
    const request = { projectId: project.id, viewer: { kind: "main" } as const, query: "apple", mode: "vector" as const };
    const before = await ctx.retrieval.search(request);
    await close(ctx);
    const reopened = await open(path, adapter());
    await settle(reopened);
    expect(await reopened.retrieval.search(request)).toEqual(before);
  });

  it("requires the embedding provider for both supported modes", async () => {
    const { ctx, project, workspace, path } = await fixture(undefined, { persistent: true });
    await publish(ctx, project.id, workspace, "persist.md", "persistent apple evidence");
    await close(ctx);
    const reopened = await createApp({ storage: { path }, node: { session: { model: { provider: "mock", model: "test" } } } });
    contexts.push(reopened);
    const request = { projectId: project.id, viewer: { kind: "main" } as const, query: "apple" };
    await expect(reopened.retrieval.search(request)).rejects.toMatchObject({ code: "embedding-unconfigured" });
    await expect(reopened.retrieval.search({ ...request, mode: "vector" })).rejects.toMatchObject({ code: "embedding-unconfigured" });
  });

  it("selects a global Chunk budget before grouping and preserves ranks across Resources", async () => {
    const { ctx, project, workspace } = await fixture();
    for (let index = 0; index < 5; index++) await publish(ctx, project.id, workspace, `long${index}.md`,
      Array.from({ length: 10 }, (_, section) => `Section ${section}: ${"evidence context ".repeat(35)}`).join("\n\n"));
    const request = { projectId: project.id, viewer: { kind: "main" } as const, query: "evidence", mode: "vector" as const };
    const candidates = await ctx.indexSearch.search({ ...request, topK: 100 });
    const byResource = new Map<string, typeof candidates[number][]>();
    for (const hit of candidates) {
      const group = byResource.get(hit.resourceId) ?? [];
      group.push(hit);
      byResource.set(hit.resourceId, group);
    }
    const interleaved = Array.from({ length: 10 }, (_, index) => [...byResource.values()].flatMap(group => group[index] ?? [])).flat();
    const spy = vi.spyOn(ctx.indexSearch, "search").mockImplementation(async input => interleaved.slice(0, input.topK));
    const atomic = vi.spyOn(ctx.storage, "atomic");
    const result = await ctx.retrieval.search(request);
    expect(atomic).toHaveBeenCalledOnce();
    const chunks = result.flatMap(group => group.chunks).sort((a, b) => a.rank - b.rank);
    expect(chunks).toHaveLength(10);
    expect(chunks.map(chunk => chunk.chunkId)).toEqual(interleaved.slice(0, 10).map(chunk => chunk.chunkId));
    expect(chunks.map(chunk => chunk.rank)).toEqual(Array.from({ length: 10 }, (_, index) => index + 1));
    expect(result.every(group => !Object.hasOwn(group, "score") && group.fusionScore === group.chunks[0]!.fusionScore)).toBe(true);
    expect(chunks.every(chunk => !Object.hasOwn(chunk, "score") && chunk.fusionScore > 0)).toBe(true);
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ topK: 30 }));
    const capped = await ctx.retrieval.search({ ...request, topK: 20, vectorTopK: 50 });
    expect(capped.flatMap(group => group.chunks)).toHaveLength(15);
    expect(capped.every(group => group.chunks.length === 3)).toBe(true);
    expect(spy).toHaveBeenLastCalledWith(expect.objectContaining({ topK: 50 }));
    expect((await ctx.retrieval.search({ ...request, topK: 1 })).flatMap(group => group.chunks)).toHaveLength(1);
  });

  it.each([{ query: " " }, { query: "x".repeat(4097) }, { topK: 0 }, { maxHops: 3 }, { vectorTopK: 0 }, { vectorTopK: 101 }, { mode: "keyword" as never }])("rejects invalid query options %j", async options => {
    const { ctx, project } = await fixture();
    await expect(ctx.retrieval.search({ projectId: project.id, viewer: { kind: "main" }, query: "Alice", ...options }))
      .rejects.toMatchObject({ code: "invalid-query" });
  });
});
