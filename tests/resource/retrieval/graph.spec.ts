import { afterEach, describe, expect, it } from "vitest";
import { graphSearch } from "../../../src/resource/retrieval/graph.js";
import { fuseRanks } from "../../../src/resource/retrieval/fusion.js";
import type { GraphSnapshot } from "../../../src/resource/graph/read.js";
import { createResourceId } from "../../../src/brand/ids.js";
import { cleanup, fixture, publish } from "../graph/fixture.js";

afterEach(cleanup);

describe("Local graph retrieval", () => {
  it("matches full Chinese names with longest overlap priority regardless of graph order", () => {
    const names = ["图", "图谱", "检索", "图谱检索"];
    const graph: GraphSnapshot = { entities: names.map((name, index) => ({ id: String(index), name, type: "Topic",
      evidence: [{ resourceId: createResourceId(`r${index}`), assetGeneration: 1, chunkId: `c${index}` }] })), relations: [] };
    const search = (query: string, value = graph) => graphSearch(value, query, new Set(), 0).map(hit => hit.chunkId);
    expect(search("如何使用图谱检索？")).toEqual(["c3"]);
    expect(search("如何使用图谱检索？", { ...graph, entities: [...graph.entities].reverse() })).toEqual(["c3"]);
    expect(search("图谱检索与图谱")).toEqual(["c3", "c1"]);
    expect(search("图")).toEqual(["c0"]);
    expect(search("地图", { ...graph, entities: graph.entities.slice(0, 1) })).toEqual([]);
  });

  it("selects capped exact seeds deterministically and keeps word boundaries and normalization", () => {
    const graph = cycle(30);
    const query = graph.entities.map(entity => entity.name).reverse().join(" ");
    expect(graphSearch(graph, query, new Set(), 0)).toEqual(graphSearch({ ...graph, entities: [...graph.entities].reverse() }, query, new Set(), 0));
    expect(graphSearch(graph, "ＮＡＭＥ０", new Set(), 0).map(hit => hit.chunkId)).toEqual(["c0"]);
    expect(graphSearch(graph, "Name000", new Set(), 0)).toEqual([]);
  });

  it("uses visible relationship evidence for endpoints without a separate mention record", async () => {
    const { ctx, project, workspace } = await fixture(chunks => ({ entities: [
      { id: "a", name: "Alice", type: "Person", chunkIds: [] },
      { id: "b", name: "Bob", type: "Person", chunkIds: [] },
    ], relations: [{ source: "a", target: "b", type: "KNOWS", chunkId: chunks[0]!.id }] }));
    const resource = await publish(ctx, project.id, workspace);
    const results = await ctx.retrieval.search({ projectId: project.id, viewer: { kind: "main" }, query: "Alice" });
    expect(results[0]!.chunks.flatMap(chunk => chunk.paths).some(path => path.entities[1]!.name === "Bob")).toBe(true);
    expect(results[0]!.chunks[0]!.paths[0]!.relations[0]!.evidence[0]!.resourceId).toBe(resource.id);
  });

  it("returns a two-document two-hop path with original directed edges and current evidence", async () => {
    const { ctx, project, workspace } = await fixture(chunks => {
      const first = chunks[0]!.text.includes("Alice");
      return { entities: [
        { id: "a", name: first ? "Alice" : "Acme", type: "Entity", chunkIds: [chunks[0]!.id] },
        { id: "b", name: first ? "Acme" : "Lab", type: "Entity", chunkIds: [chunks[0]!.id] },
      ], relations: [{ source: "a", target: "b", type: first ? "FOUNDED" : "FUNDS", chunkId: chunks[0]!.id }] };
    });
    const first = await publish(ctx, project.id, workspace, "founder.md", "Alice founded Acme.");
    const second = await publish(ctx, project.id, workspace, "funding.md", "Acme funds Lab.");
    const request = { projectId: project.id, viewer: { kind: "main" } as const, query: "Alice", maxHops: 2 };
    const results = await ctx.retrieval.search(request);
    const paths = results.flatMap(hit => hit.chunks.flatMap(chunk => chunk.paths));
    const path = paths.find(path => path.relations.length === 2 && path.entities[0]!.name === "Alice")!;
    expect(path.entities.map(entity => entity.name)).toEqual(["Alice", "Acme", "Lab"]);
    expect(path.relations.map(edge => edge.type)).toEqual(["FOUNDED", "FUNDS"]);
    expect(path.relations.map(edge => edge.direction)).toEqual(["outgoing", "outgoing"]);
    expect(path.relations.map(edge => edge.evidence[0]!.resourceId)).toEqual([first.id, second.id]);
    const source = results.find(result => result.resourceId === second.id)!.chunks[0]!;
    expect(source.matches).toContain("graph");
    expect(source.text.slice(source.startOffsetUtf16, source.endOffsetUtf16)).toBe("Acme funds Lab.");
    expect(source.assetGeneration).toBe(second.assetGeneration);
    const one = await ctx.retrieval.search({ ...request, maxHops: 1 });
    expect(one.flatMap(hit => hit.chunks.flatMap(chunk => chunk.paths)).every(path => path.relations.length <= 1)).toBe(true);
    const zero = await ctx.retrieval.search({ ...request, maxHops: 0 });
    expect(zero.flatMap(hit => hit.chunks.flatMap(chunk => chunk.paths))).toEqual([]);

    ctx.resources.createUserFolder(project.id, "Restricted");
    ctx.resources.organizeUserResource({ projectId: project.id, resourceId: second.id,
      expectedRevision: second.revision, folder: "Restricted" });
    const scoped = await ctx.retrieval.search({ ...request, resourceIds: [first.id] });
    expect(JSON.stringify(scoped)).not.toContain(second.id);
    expect(JSON.stringify(scoped)).not.toContain('"Lab"');
  });

  it("does not cross a private bridge even when both visible endpoint names exist", async () => {
    const { ctx, project, workspace } = await fixture(chunks => {
      const privateBridge = chunks[0]!.text.includes("secret");
      return { entities: [
        { id: "a", name: "Alice", type: "Person", chunkIds: [chunks[0]!.id] },
        { id: "b", name: "Bob", type: "Person", chunkIds: [chunks[0]!.id] },
      ], relations: privateBridge ? [{ source: "a", target: "b", type: "SECRET", chunkId: chunks[0]!.id }] : [] };
    });
    const visible = await publish(ctx, project.id, workspace, "visible.md", "Alice and Bob.");
    const secret = await publish(ctx, project.id, workspace, "secret.md", "secret Alice and Bob.");
    ctx.resources.setAccess({ projectId: project.id, resourceId: visible.id, actor: { kind: "main" },
      expectedRevision: visible.revision, access: { kind: "public" } });
    const node = ctx.nodes.create({ projectId: project.id, objective: { title: "Reader", description: "Read", acceptanceCriteria: ["Read"] } });
    const results = await ctx.retrieval.search({ projectId: project.id, viewer: { kind: "node", nodeId: node.node.id }, query: "Alice" });
    expect(results.map(result => result.resourceId)).toEqual([visible.id]);
    expect(JSON.stringify(results)).not.toContain(secret.id);
    expect(JSON.stringify(results)).not.toContain("SECRET");
    expect(results.flatMap(result => result.chunks.flatMap(chunk => chunk.paths))).toEqual([]);
  });

  it("bounds cycles and hops, supports reverse traversal and avoids partial-name seeds", () => {
    const graph = cycle(90);
    const reverse = graphSearch(graph, "Name0", new Set(), 1);
    expect(reverse.some(hit => hit.paths.some(path => path.relations[0]!.direction === "incoming"))).toBe(true);
    const hits = graphSearch(graph, "Name0", new Set(), 2);
    expect(hits.every(hit => hit.paths.every(path => path.relations.length <= 2))).toBe(true);
    expect(hits.every(hit => hit.paths.every(path => new Set(path.entities.map(entity => entity.id)).size === path.entities.length))).toBe(true);
    expect(graphSearch(graph, "Name000", new Set(), 2)).toEqual([]);
    const broad = graphSearch(graph, "", new Set(graph.entities.map(entity => entity.evidence[0]!.chunkId)), 2);
    expect(new Set(broad.map(hit => hit.chunkId)).size).toBeLessThanOrEqual(40);
    expect(new Set(broad.filter(hit => hit.route === "entity").map(hit => hit.chunkId)).size).toBeLessThanOrEqual(10);
    expect(new Set(broad.flatMap(hit => hit.paths.flatMap(path => path.entities.map(entity => entity.id)))).size).toBeLessThanOrEqual(64);
  });

  it("caps graph evidence at 40 distinct Chunks", () => {
    const graph = cycle(60);
    const star = { ...graph, relations: graph.relations.map((relation, index) => ({ ...relation,
      sourceId: "0", targetId: String(index + 1) })) };
    const hits = graphSearch(star, "Name0", new Set(), 2);
    expect(new Set(hits.map(hit => hit.chunkId)).size).toBe(40);
  });

  it("uses RRF ranks rather than incomparable raw scores and counts each route once per Chunk", () => {
    const a = { chunkId: "a", route: "vector" as const, paths: [] };
    const b = { chunkId: "b", route: "vector" as const, paths: [] };
    const c = { chunkId: "c", route: "graph" as const, paths: [] };
    const fused = fuseRanks([[a, a, b], [c, { ...b, route: "graph" }]]);
    expect(fused.map(hit => hit.chunkId)).toEqual(["b", "a", "c"]);
    expect(fused[0]!.score).toBeCloseTo(2 / 62);
    expect(fused[0]!.matches).toEqual(["vector", "graph"]);
    expect(fused[1]!.score).toBeCloseTo(1 / 61);
  });
});

function cycle(size: number): GraphSnapshot {
  const evidence = (index: number) => [{ resourceId: createResourceId(`r${index}`), assetGeneration: 1, chunkId: `c${index}` }];
  return { entities: Array.from({ length: size }, (_, index) => ({ id: String(index), name: `Name${index}`, type: "Entity", evidence: evidence(index) })),
    relations: Array.from({ length: size }, (_, index) => ({ id: `r${index}`, sourceId: String(index), targetId: String((index + 1) % size),
      type: "NEXT", evidence: evidence(index) })) };
}
