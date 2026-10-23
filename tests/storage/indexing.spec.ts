import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";
import { StorageService } from "../../src/storage/database.js";
import type { ResourceIndexBuildRecord, ResourceChunkRecord } from "../../src/storage/indexing.js";

const contexts: Context[] = [];
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())); });

describe("resource index storage", () => {
  it("publishes only complete current builds and switches active generations atomically", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    await ctx.plugin(StorageService, { path: ":memory:" });
    ctx.storage.atomic(tx => tx.putResourceContent(content(1)));
    const first = build("first", 1, 1);
    ctx.storage.atomic(tx => tx.createIndexBuild(first, [chunk("first", 0)]));
    expect(ctx.storage.atomic(tx => tx.publishIndexBuild("first"))).toBe(false);
    expect(ctx.storage.atomic(tx => tx.writeChunkEmbeddings("first", [{ chunkId: "first:0", embedding: new Uint8Array(8) }]))).toBe(true);
    expect(ctx.storage.atomic(tx => tx.publishIndexBuild("first"))).toBe(true);

    const second = build("second", 1, 1);
    ctx.storage.atomic(tx => tx.createIndexBuild(second, [chunk("second", 0)]));
    expect(ctx.storage.atomic(tx => tx.writeChunkEmbeddings("second", [{ chunkId: "second:0", embedding: new Uint8Array(8) }]))).toBe(true);
    expect(ctx.storage.atomic(tx => tx.publishIndexBuild("second"))).toBe(true);
    expect(ctx.storage.atomic(tx => tx.listIndexBuilds()).map(row => [row.build_id, row.status]))
      .toEqual([["first", "superseded"], ["second", "active"]]);
  });

  it("rejects parallel building rows and rolls back a mismatched batch without partial writes", async () => {
    const ctx = new Context();
    contexts.push(ctx);
    await ctx.plugin(StorageService, { path: ":memory:" });
    const first = build("first", 1, 2);
    ctx.storage.atomic(tx => tx.createIndexBuild(first, [chunk("first", 0), chunk("first", 1)]));
    expect(() => ctx.storage.atomic(tx => tx.createIndexBuild(build("second", 1, 0), [])))
      .toThrow(expect.objectContaining({ code: "ERR_SQLITE_ERROR" }));
    expect(ctx.storage.atomic(tx => tx.writeChunkEmbeddings("first", [
      { chunkId: "first:0", embedding: new Uint8Array(8) },
      { chunkId: "missing", embedding: new Uint8Array(8) },
    ]))).toBe(false);
    expect(ctx.storage.atomic(tx => tx.listPendingChunks("first", 10))).toHaveLength(2);
  });
});

function content(generation: number) {
  return { project_id: "p1", resource_id: "r1", source_asset_generation: generation, status: "ready" as const,
    body: "body", page_map_json: "[]", extractor_version: "test", processing_attempt_id: null,
    error_code: null, error_message: null, updated_at: "2026-10-23T00:00:00.000Z" };
}

function build(id: string, generation: number, count: number): ResourceIndexBuildRecord {
  return { build_id: id, project_id: "p1", resource_id: "r1", source_asset_generation: generation,
    status: "building", chunker_version: "structured-v1", embedding_provider: "mock", embedding_model: "mock",
    embedding_revision: null, embedding_dimension: 2, document_template_version: "doc-v1", query_template_version: "query-v1",
    vector_encoding_version: "float32le-l2-v1", expected_chunk_count: count, attempt_count: 0, error_code: null,
    error_message: null, created_at: `2026-10-23T00:00:0${id === "first" ? "0" : "1"}.000Z`, updated_at: "2026-10-23T00:00:00.000Z" };
}

function chunk(buildId: string, ordinal: number): ResourceChunkRecord {
  return { chunk_id: `${buildId}:${ordinal}`, build_id: buildId, ordinal, text: `text ${ordinal}`, embedding_text: `text ${ordinal}`,
    start_offset_utf16: ordinal * 6, end_offset_utf16: ordinal * 6 + 6, heading_path_json: "[]", structure: "paragraph",
    page_map_json: "[]", embedding: null };
}
