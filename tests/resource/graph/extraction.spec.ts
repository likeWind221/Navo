import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";
import { createToolCallId } from "../../../src/brand/ids.js";
import { LLMService } from "../../../src/llm/service.js";
import { GraphExtractor } from "../../../src/resource/graph/extraction.js";
import type { ResourceChunkRecord } from "../../../src/storage/indexing.js";
import { adapter, config, facts } from "./fixture.js";

const contexts: Context[] = [];
afterEach(async () => { await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose())); });

async function context() { const ctx = new Context(); contexts.push(ctx); await ctx.plugin(LLMService); return ctx; }
function chunk(ordinal: number, text = "Alice knows Bob"): ResourceChunkRecord {
  return { chunk_id: `c${ordinal}`, build_id: "i1", ordinal, text, embedding_text: text, start_offset_utf16: 0,
    end_offset_utf16: text.length, heading_path_json: "[]", structure: "paragraph", page_map_json: "[]", embedding: null };
}

describe("batched graph extraction", () => {
  it("uses structured tool output and validates it at runtime", async () => {
    const ctx = await context();
    const id = createToolCallId("graph-call");
    ctx.llm.registerAdapter("graph-test", { async *stream(request) {
      expect(request.tools?.[0]?.name).toBe("extract_graph");
      expect(request).not.toHaveProperty("maxTokens");
      expect(request).not.toHaveProperty("temperature");
      yield { type: "content-started", contentIndex: 0, contentType: "tool-call", toolCallId: id };
      yield { type: "content-delta", contentIndex: 0, contentType: "tool-call", toolCallId: id,
        toolNameDelta: "extract_graph", delta: JSON.stringify(facts([{ id: "c0", text: "body" }])) };
      yield { type: "content-completed", contentIndex: 0, contentType: "tool-call" };
      yield { type: "finished", reason: { kind: "tool-calls" } };
    } });
    const extractor = new GraphExtractor(ctx.llm, config);
    const results: unknown[] = [];
    await extractor.extract([chunk(0)], new AbortController().signal, (_, graph) => results.push(graph));
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ entities: [{ name: "Alice" }, { name: "Bob" }] });
  });

  it("uses only graph-specific generation settings and fingerprints their effective values", async () => {
    const ctx = await context();
    const llm = adapter();
    ctx.llm.registerAdapter("graph-test", llm);
    const configured = { ...config, model: { ...config.model, maxTokens: 20_000, temperature: 0.7 } };
    const extractor = new GraphExtractor(ctx.llm, configured);
    await extractor.extract([chunk(0)], new AbortController().signal, () => {});
    expect(llm.requests[0]).toMatchObject({ maxTokens: 20_000, temperature: 0.7 });
    const baseline = new GraphExtractor(ctx.llm, config);
    expect(extractor.pipelineVersion).not.toBe(baseline.pipelineVersion);
    expect(new GraphExtractor(ctx.llm, { ...configured, model: { ...configured.model, temperature: 0 } }).pipelineVersion)
      .not.toBe(extractor.pipelineVersion);
    expect(new GraphExtractor(ctx.llm, { ...configured, model: { ...configured.model, maxTokens: 8192 } }).pipelineVersion)
      .not.toBe(extractor.pipelineVersion);
    expect(new GraphExtractor(ctx.llm, { ...config, model: { model: config.model.model, provider: config.model.provider } }).pipelineVersion)
      .toBe(baseline.pipelineVersion);
  });

  it.each([{ maxTokens: 0 }, { maxTokens: 1.5 }, { temperature: Number.NaN }])("rejects invalid generation settings %j", async parameters => {
    const ctx = await context();
    expect(() => new GraphExtractor(ctx.llm, { ...config, model: { ...config.model, ...parameters } }))
      .toThrow("Graph generation parameters are invalid");
  });

  it("packs multiple chunks within the budget and rejects an oversized single chunk", async () => {
    const ctx = await context();
    const extractor = new GraphExtractor(ctx.llm, config);
    expect(extractor.batch([chunk(0), chunk(1)])).toHaveLength(2);
    const batch = extractor.batch(Array.from({ length: 30 }, (_, i) => chunk(i, "字".repeat(1000))));
    expect(batch.length).toBeGreaterThan(0);
    expect(batch.length).toBeLessThan(30);
    expect(() => extractor.batch([chunk(0, "字".repeat(8192))])).toThrow(expect.objectContaining({ code: "input-limit" }));
  });

  it("retries malformed output twice then splits, committing children in order", async () => {
    const ctx = await context();
    const llm = adapter(chunks => chunks.length > 1 ? "{" : facts(chunks));
    ctx.llm.registerAdapter("graph-test", llm);
    const committed: string[] = [];
    await new GraphExtractor(ctx.llm, config).extract([chunk(0), chunk(1)], new AbortController().signal,
      chunks => committed.push(...chunks.map(value => value.chunk_id)));
    expect(llm.requests).toHaveLength(4);
    expect(committed).toEqual(["c0", "c1"]);
  });

  it("stops retrying a malformed singleton and never commits it", async () => {
    const ctx = await context();
    const llm = adapter(() => "bad json");
    ctx.llm.registerAdapter("graph-test", llm);
    let writes = 0;
    await expect(new GraphExtractor(ctx.llm, config).extract([chunk(0)], new AbortController().signal, () => writes++))
      .rejects.toMatchObject({ code: "invalid-output" });
    expect(writes).toBe(0);
    expect(llm.requests).toHaveLength(2);
  });

  it.each(["max-tokens", "bytes"])("bounds %s output and splits before accepting results", async mode => {
    const ctx = await context();
    let calls = 0;
    ctx.llm.registerAdapter("graph-test", { async *stream(request) {
      calls++;
      if (calls <= 2) {
        if (mode === "bytes") {
          yield { type: "content-started", contentIndex: 0, contentType: "text" };
          yield { type: "content-delta", contentIndex: 0, contentType: "text", delta: "x".repeat(65537) };
        }
        yield { type: "finished", reason: { kind: "max-tokens" } };
      } else yield* adapter().stream(request);
    } });
    const writes: string[] = [];
    await new GraphExtractor(ctx.llm, config).extract([chunk(0), chunk(1)], new AbortController().signal,
      chunks => writes.push(chunks[0]!.chunk_id));
    expect(writes).toEqual(["c0", "c1"]);
    expect(calls).toBe(4);
  });

  it("does not retry transport errors or persistence failures", async () => {
    const ctx = await context();
    const llm = adapter(() => { throw new Error("offline"); });
    const unregister = ctx.llm.registerAdapter("graph-test", llm);
    await expect(new GraphExtractor(ctx.llm, config).extract([chunk(0), chunk(1)], new AbortController().signal, () => {}))
      .rejects.toMatchObject({ code: "model-failed" });
    expect(llm.requests).toHaveLength(1);
    unregister();
    const valid = adapter();
    ctx.llm.registerAdapter("graph-test", valid);
    await expect(new GraphExtractor(ctx.llm, config).extract([chunk(0)], new AbortController().signal,
      () => { throw new Error("disk unavailable"); })).rejects.toThrow("disk unavailable");
    expect(valid.requests).toHaveLength(1);
  });
});
