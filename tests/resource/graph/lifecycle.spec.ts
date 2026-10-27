import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, facts, fixture, publish, settle } from "./fixture.js";

afterEach(cleanup);

describe("graph lifecycle and visibility", () => {
  it("deduplicates directed relations and retains independent sources through replacement and deletion", async () => {
    const { ctx, project, workspace, llm } = await fixture(chunks => {
      if (chunks.some(chunk => chunk.text.includes("empty"))) return { entities: [], relations: [] };
      const graph = facts(chunks);
      return { ...graph, relations: [...graph.relations, { source: "b", target: "a", type: "KNOWS", chunkId: chunks[0]!.id }] };
    });
    const first = await publish(ctx, project.id, workspace, "first.md");
    const second = await publish(ctx, project.id, workspace, "second.md");
    const before = ctx.resourceGraph.read(project.id, { kind: "main" });
    expect(before.entities).toHaveLength(2);
    expect(before.relations).toHaveLength(2);
    expect(before.relations.every(relation => relation.evidence.length === 2)).toBe(true);
    expect(ctx.resourceGraph.status(project.id, first.id)?.status).toBe("active");
    expect(ctx.resourceGraph.describe(project.id, first.id)).toEqual({ status: "active", readable: true, errorCode: null });
    await writeFile(join(workspace, "replacement.md"), "empty document");
    const replaced = await ctx.resources.replace({ projectId: project.id, resourceId: first.id, actor: { kind: "main" },
      expectedRevision: first.revision, sourceRef: "replacement.md" });
    const immediate = ctx.resourceGraph.read(project.id, { kind: "main" });
    expect(immediate.relations.every(relation => relation.evidence.every(source => source.resourceId === second.id))).toBe(true);
    await settle(ctx);
    const after = ctx.resourceGraph.read(project.id, { kind: "main" });
    expect(after.relations.map(relation => relation.id)).toEqual(before.relations.map(relation => relation.id));
    expect(after.relations.every(relation => relation.evidence.length === 1)).toBe(true);
    await ctx.resources.delete({ projectId: project.id, resourceId: second.id, actor: { kind: "main" }, expectedRevision: second.revision });
    expect(ctx.resourceGraph.read(project.id, { kind: "main" })).toEqual({ entities: [], relations: [] });
    expect(ctx.storage.atomic(tx => tx.readGraphEvidence(project.id, [first.id, second.id]))).toEqual([]);
    expect(ctx.resourceGraph.status(project.id, first.id)?.source_asset_generation).toBe(replaced.assetGeneration);
    await settle(ctx);
    expect(llm.requests).toHaveLength(3);
  });

  it("merges by project, type and NFC name only", async () => {
    let call = 0;
    const { ctx, project, workspace, root } = await fixture(chunks => ({ entities: [
      { id: "same", name: call++ === 0 ? "  Cafe\u0301\tLab " : "Café Lab", type: "Organization", chunkIds: [chunks[0]!.id] },
      { id: "case", name: "café Lab", type: "Organization", chunkIds: [chunks[0]!.id] },
      { id: "type", name: "Café Lab", type: "Place", chunkIds: [chunks[0]!.id] },
    ], relations: [] }));
    await publish(ctx, project.id, workspace, "first.md");
    await publish(ctx, project.id, workspace, "second.md");
    const graph = ctx.resourceGraph.read(project.id, { kind: "main" });
    expect(graph.entities).toHaveLength(3);
    expect(graph.entities.every(entity => entity.evidence.length === 2)).toBe(true);
    const other = ctx.projects.create({ name: "Other", goal: null });
    const otherRoot = join(root, "other");
    await mkdir(otherRoot);
    await ctx.projectWorkspaces.create(other.id, otherRoot);
    await publish(ctx, other.id, otherRoot);
    const otherGraph = ctx.resourceGraph.read(other.id, { kind: "main" });
    expect(otherGraph.entities).toHaveLength(3);
    expect(otherGraph.entities.some(entity => graph.entities.some(existing => existing.id === entity.id))).toBe(false);
  });

  it("shared entities do not expose private evidence or private-only entities to Nodes", async () => {
    const { ctx, project, workspace } = await fixture(chunks => {
      const graph = facts(chunks);
      return chunks[0]!.text.includes("secret") ? { ...graph, entities: [...graph.entities,
        { id: "secret", name: "Secret Plan", type: "Project", chunkIds: [chunks[0]!.id] }] } : graph;
    });
    const node = ctx.nodes.create({ projectId: project.id, objective: { title: "Reader", description: "Read", acceptanceCriteria: ["Read"] } });
    const shared = await publish(ctx, project.id, workspace, "shared.md");
    const secret = await publish(ctx, project.id, workspace, "secret.md", "secret Alice knows Bob");
    const visible = ctx.resources.setAccess({ projectId: project.id, resourceId: shared.id, actor: { kind: "main" },
      expectedRevision: shared.revision, access: { kind: "public" } });
    const graph = ctx.resourceGraph.read(project.id, { kind: "node", nodeId: node.node.id });
    expect(graph.entities.map(entity => entity.name).sort()).toEqual(["Alice", "Bob"]);
    expect(graph.relations).toHaveLength(1);
    expect(graph.relations[0]!.evidence.map(source => source.resourceId)).toEqual([shared.id]);
    expect(JSON.stringify(graph)).not.toContain(secret.id);
    ctx.resources.setAccess({ projectId: project.id, resourceId: shared.id, actor: { kind: "main" },
      expectedRevision: visible.revision, access: { kind: "private" } });
    expect(ctx.resourceGraph.read(project.id, { kind: "node", nodeId: node.node.id })).toEqual({ entities: [], relations: [] });
  });
});
