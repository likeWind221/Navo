import { afterEach, describe, expect, it, vi } from "vitest";

import { createResourceId, createSessionId, createToolCallId } from "../../../src/brand/ids.js";
import { ResourceIndexError } from "../../../src/resource/index/errors.js";
import type { RetrievalResult } from "../../../src/resource/retrieval/types.js";
import { bindResourceNode, callResourceTool, cleanupResourceToolFixtures, resourceArtifact, resourceResultText, resourceToolFixture } from "./helpers.js";

afterEach(cleanupResourceToolFixtures);

const resourceId = createResourceId("evidence");
const hits: readonly RetrievalResult[] = [{ resourceId, name: "Evidence", libraryPath: "Papers/evidence.md", assetGeneration: 2,
  fusionScore: 0.5, chunks: [{ resourceId, chunkId: "chunk", ordinal: 0, rank: 1, text: "Original evidence", headingPath: ["Methods"],
    pages: [3], assetGeneration: 2, startOffsetUtf16: 0, endOffsetUtf16: 17, fusionScore: 0.5, matches: ["vector", "graph"], paths: [{
      entities: [{ id: "a", name: "Alice", type: "Person" }, { id: "b", name: "Bob", type: "Person" }],
      relations: [{ id: "r", sourceId: "a", targetId: "b", type: "KNOWS", direction: "outgoing",
        evidence: [{ resourceId, assetGeneration: 2, chunkId: "chunk" }] }],
    }] }],
}];

describe("search_resources", () => {
  it("uses trusted Main and Node identity, preserves snippets, locations and relationship sources", async () => {
    const { app, project } = await resourceToolFixture();
    const node = bindResourceNode(app, project.id);
    const search = vi.spyOn(app.retrieval, "search").mockResolvedValue(hits);
    const result = await callResourceTool(app, project.mainSessionId, "search_resources", { query: "Alice", folder: "Papers", top_k: 4 });
    expect(search).toHaveBeenLastCalledWith({ projectId: project.id, viewer: { kind: "main" }, query: "Alice",
      topK: 4, folder: "Papers", signal: expect.any(AbortSignal) });
    expect(resourceArtifact(result)).toEqual({ status: "found", resources: [{ resource_id: resourceId, name: "Evidence",
      libraryPath: "Papers/evidence.md", assetGeneration: 2, snippets: [{ chunkId: "chunk", text: "Original evidence", headingPath: ["Methods"],
        pages: [3], rank: 1, matches: ["vector", "graph"], paths: hits[0]!.chunks[0]!.paths }] }] });
    expect(resourceResultText(result)).toContain("Original evidence");
    await callResourceTool(app, node.sessionId, "search_resources", { query: "Bob" });
    expect(search).toHaveBeenLastCalledWith({ projectId: project.id, viewer: { kind: "node", nodeId: node.node.node.id },
      query: "Bob", topK: 10, signal: expect.any(AbortSignal) });
  });

  it("distinguishes a successful empty search from index or configuration failure", async () => {
    const { app, project } = await resourceToolFixture();
    const search = vi.spyOn(app.retrieval, "search").mockResolvedValue([]);
    expect(resourceArtifact(await callResourceTool(app, project.mainSessionId, "search_resources", { query: "missing" })))
      .toEqual({ status: "empty", resources: [] });
    for (const code of ["embedding-unconfigured", "index-failed", "index-stale"] as const) {
      search.mockRejectedValueOnce(new ResourceIndexError(code, "internal diagnostics"));
      const result = await callResourceTool(app, project.mainSessionId, "search_resources", { query: "evidence" });
      expect(result).toMatchObject({ kind: "failure", block: { isError: true },
        failure: { code: "tool-failed", modelMessage: `Resource search failed (${code}).` } });
      expect(resourceResultText(result)).not.toContain("internal diagnostics");
    }
    search.mockRejectedValueOnce(new Error("provider failure"));
    expect((await callResourceTool(app, project.mainSessionId, "search_resources", { query: "evidence" })).kind).toBe("failure");
  });

  it.each([{}, { query: "" }, { query: " " }, { query: "x".repeat(4097) }, { query: 7 }, { query: "x", top_k: 0 },
    { query: "x", top_k: 101 }, { query: "x", top_k: 1.5 }, { query: "x", folder: "../hidden" },
    { query: "x", project_id: "forged" }, { query: "x", viewer: { kind: "main" } }])("rejects invalid query options", async args => {
    const { app, project } = await resourceToolFixture();
    const search = vi.spyOn(app.retrieval, "search");
    expect((await callResourceTool(app, project.mainSessionId, "search_resources", args)).kind).toBe("failure");
    expect(search).not.toHaveBeenCalled();
  });

  it("accepts the query and top_k boundaries and rejects an unbound Session", async () => {
    const { app, project } = await resourceToolFixture();
    const search = vi.spyOn(app.retrieval, "search").mockResolvedValue([]);
    for (const top_k of [1, 100]) expect((await callResourceTool(app, project.mainSessionId, "search_resources", { query: "x".repeat(4096), top_k })).kind).toBe("success");
    search.mockClear();
    expect((await callResourceTool(app, createSessionId("unbound"), "search_resources", { query: "x" })).kind).toBe("failure");
    expect(search).not.toHaveBeenCalled();
  });

  it("passes the execution signal through and preserves cancellation before and during search", async () => {
    const { app, project } = await resourceToolFixture();
    const controller = new AbortController();
    const search = vi.spyOn(app.retrieval, "search").mockImplementation(async request => {
      expect(request.signal).toBe(controller.signal);
      controller.abort();
      request.signal!.throwIfAborted();
      return [];
    });
    const call = () => app.tools.execute({ type: "tool-call", id: createToolCallId("cancel"), name: "search_resources", arguments: '{"query":"x"}' },
      controller.signal, { sessionId: project.mainSessionId, allowedTools: ["search_resources"] });
    expect(await call()).toMatchObject({ kind: "failure", failure: { code: "cancelled" } });
    expect(await call()).toMatchObject({ kind: "failure", failure: { code: "cancelled" } });
    expect(search).toHaveBeenCalledOnce();
  });
});
