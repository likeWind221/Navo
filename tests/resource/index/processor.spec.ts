import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Context } from "cordis";
import { createApp } from "../../../src/app.js";
import type { EmbeddingProvider, EmbeddingRequest } from "../../../src/embedding/types.js";
import { CHUNKER_VERSION } from "../../../src/resource/index/chunker.js";
import { encodeVector, VECTOR_ENCODING_VERSION } from "../../../src/resource/index/vector.js";

const contexts: Context[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

describe("Resource index lifecycle and semantic search", () => {
  it("builds, atomically publishes, replaces and excludes deleted generations", async () => {
    const provider = new MockEmbedding();
    const { ctx, project, root } = await fixture(provider);
    await writeFile(join(root, "report.md"), "# Fruit\n\napple evidence\n", "utf8");
    const resource = await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "report.md",
      name: "Report", description: "", type: "text/markdown" });
    await settled(ctx);
    expect(ctx.resourceIndex.status(project.id, resource.id)).toMatchObject({ status: "active" });
    await expect(ctx.indexSearch.search({ projectId: project.id, viewer: { kind: "main" }, query: "apple", topK: 2 }))
      .resolves.toEqual([expect.objectContaining({ resourceId: resource.id, text: expect.stringContaining("apple"), score: 1 })]);

    await writeFile(join(root, "replacement.md"), "# Fruit\n\nbanana evidence\n", "utf8");
    const replaced = await ctx.resources.replace({ projectId: project.id, resourceId: resource.id,
      actor: { kind: "main" }, expectedRevision: resource.revision, sourceRef: "replacement.md" });
    await settled(ctx);
    const builds = ctx.storage.atomic(tx => tx.listIndexBuilds()).filter(build => build.resource_id === resource.id);
    expect(builds.map(build => build.status).sort()).toEqual(["active", "superseded"]);
    expect(builds.find(build => build.status === "active")?.source_asset_generation).toBe(replaced.assetGeneration);
    await expect(ctx.indexSearch.search({ projectId: project.id, viewer: { kind: "main" }, query: "banana" }))
      .resolves.toEqual([expect.objectContaining({ text: expect.stringContaining("banana") })]);

    await ctx.resources.delete({ projectId: project.id, resourceId: resource.id, actor: { kind: "main" },
      expectedRevision: replaced.revision });
    await expect(ctx.indexSearch.search({ projectId: project.id, viewer: { kind: "main" }, query: "banana" })).resolves.toEqual([]);
  });

  it("limits SQL candidates to visible Resources before scoring", async () => {
    const provider = new MockEmbedding();
    const { ctx, project, root } = await fixture(provider);
    const node = ctx.nodes.create({ projectId: project.id, objective: { title: "Reader", description: "Read",
      acceptanceCriteria: ["Read"] } });
    await writeFile(join(root, "secret.md"), "secret alpha", "utf8");
    await writeFile(join(root, "shared.md"), "shared beta", "utf8");
    const secret = await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "secret.md",
      name: "Secret", description: "", type: "text/markdown" });
    const shared = await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "shared.md",
      name: "Shared", description: "", type: "text/markdown" });
    ctx.resources.setAccess({ projectId: project.id, resourceId: shared.id, actor: { kind: "main" },
      expectedRevision: shared.revision, access: { kind: "public" } });
    await settled(ctx);
    const results = await ctx.indexSearch.search({ projectId: project.id, viewer: { kind: "node", nodeId: node.node.id },
      query: "secret", resourceIds: [secret.id, shared.id], topK: 10 });
    expect(results.map(result => result.resourceId)).toEqual([shared.id]);
    expect(results[0]?.text).not.toContain("secret");
  });

  it("keeps a failed or cancelled build invisible and reports waiting configuration", async () => {
    const provider = new MockEmbedding();
    provider.embedMany = vi.fn(async () => { throw new Error("offline"); });
    const { ctx, project, root } = await fixture(provider);
    await writeFile(join(root, "failed.md"), "failed body", "utf8");
    const resource = await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "failed.md",
      name: "Failed", description: "", type: "text/markdown" });
    await settled(ctx);
    expect(ctx.resourceIndex.status(project.id, resource.id)).toMatchObject({ status: "failed", errorCode: "index-failed" });
    expect(ctx.storage.atomic(tx => tx.listActiveChunks({ projectId: project.id, resourceIds: [resource.id],
      provider: provider.id, model: provider.model, revision: null, dimension: 2,
      documentTemplateVersion: provider.documentTemplateVersion, queryTemplateVersion: provider.queryTemplateVersion,
      encodingVersion: "float32le-l2-v1", afterChunkId: null, limit: 10 }))).toEqual([]);
    provider.embedMany = vi.fn(async ({ inputs }: EmbeddingRequest) => inputs.map(() => [0, 1]));
    ctx.resourceIndex.retry(project.id, resource.id);
    await ctx.resourceIndex.idle();
    expect(ctx.resourceIndex.status(project.id, resource.id)).toMatchObject({ status: "active" });

    const unconfigured = await fixture(undefined);
    await writeFile(join(unconfigured.root, "waiting.md"), "waiting body", "utf8");
    const waiting = await unconfigured.ctx.resources.publish({ projectId: unconfigured.project.id, owner: { kind: "main" },
      sourceRef: "waiting.md", name: "Waiting", description: "", type: "text/markdown" });
    await unconfigured.ctx.content.idle();
    expect(unconfigured.ctx.resourceIndex.status(unconfigured.project.id, waiting.id)).toEqual({ status: "waiting-config" });
    await expect(unconfigured.ctx.indexSearch.search({ projectId: unconfigured.project.id, viewer: { kind: "main" }, query: "waiting" }))
      .rejects.toMatchObject({ code: "embedding-unconfigured" });
  });

  it("resumes a current building generation and skips already persisted vectors", async () => {
    const initial = await fixture(undefined);
    await writeFile(join(initial.root, "resume.md"), "resume body", "utf8");
    const resource = await initial.ctx.resources.publish({ projectId: initial.project.id, owner: { kind: "main" },
      sourceRef: "resume.md", name: "Resume", description: "", type: "text/markdown" });
    await initial.ctx.content.idle();
    const provider = new MockEmbedding();
    const now = new Date().toISOString();
    initial.ctx.storage.atomic(tx => tx.createIndexBuild({
      build_id: "resume-build", project_id: initial.project.id, resource_id: resource.id,
      source_asset_generation: resource.assetGeneration, status: "building", chunker_version: CHUNKER_VERSION,
      embedding_provider: provider.id, embedding_model: provider.model, embedding_revision: provider.revision,
      embedding_dimension: provider.dimension, document_template_version: provider.documentTemplateVersion,
      query_template_version: provider.queryTemplateVersion, vector_encoding_version: VECTOR_ENCODING_VERSION,
      expected_chunk_count: 2, attempt_count: 1, error_code: null, error_message: null, created_at: now, updated_at: now,
    }, [
      { chunk_id: "resume-build:00000000", build_id: "resume-build", ordinal: 0, text: "resume", embedding_text: "resume",
        start_offset_utf16: 0, end_offset_utf16: 6, heading_path_json: "[]", structure: "paragraph", page_map_json: "[]",
        embedding: encodeVector([0, 1], 2) },
      { chunk_id: "resume-build:00000001", build_id: "resume-build", ordinal: 1, text: " body", embedding_text: " body",
        start_offset_utf16: 6, end_offset_utf16: 11, heading_path_json: "[]", structure: "paragraph", page_map_json: "[]", embedding: null },
    ]));
    await close(initial.ctx);

    const resumed = await createApp({ storage: { path: initial.path }, embedding: provider,
      node: { session: { model: { provider: "mock", model: "test" } } } });
    contexts.push(resumed);
    await resumed.resourceIndex.idle();
    expect(provider.embedMany).toHaveBeenCalledTimes(1);
    expect(provider.embedMany.mock.calls[0]?.[0].inputs).toEqual([" body"]);
    expect(resumed.resourceIndex.status(initial.project.id, resource.id)).toMatchObject({ status: "active", buildId: "resume-build" });
  });

  it("rejects a late provider response after cancellation without persisting the batch", async () => {
    let release: (() => void) | undefined;
    const provider = new MockEmbedding();
    provider.embedMany = vi.fn(async () => {
      await new Promise<void>(resolve => { release = resolve; });
      return [[0, 1]];
    });
    const { ctx, project, root } = await fixture(provider);
    await writeFile(join(root, "cancel.md"), "cancel body", "utf8");
    const resource = await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "cancel.md",
      name: "Cancel", description: "", type: "text/markdown" });
    await ctx.content.idle();
    await vi.waitFor(() => expect(provider.embedMany).toHaveBeenCalledOnce());
    ctx.resourceIndex.cancel();
    release?.();
    await ctx.resourceIndex.idle();
    expect(ctx.resourceIndex.status(project.id, resource.id)).toMatchObject({ status: "failed", errorCode: "cancelled" });
    const build = ctx.storage.atomic(tx => tx.listIndexBuilds("failed")[0]!);
    expect(ctx.storage.atomic(tx => tx.listPendingChunks(build.build_id, 10))).not.toHaveLength(0);
  });
});

class MockEmbedding implements EmbeddingProvider {
  readonly id = "mock-embedding";
  readonly model = "mock-model";
  readonly revision = null;
  readonly dimension = 2;
  readonly documentTemplateVersion = "mock-document-v1";
  readonly queryTemplateVersion = "mock-query-v1";
  embedMany = vi.fn(async ({ inputs }: EmbeddingRequest) => inputs.map(input => /apple|alpha|secret/i.test(input) ? [1, 0] : [0, 1]));
}

async function fixture(provider: EmbeddingProvider | undefined) {
  const base = await mkdtemp(join(tmpdir(), "navo-index-"));
  roots.push(base);
  const root = join(base, "workspace");
  await mkdir(root);
  const path = join(base, "navo.db");
  const ctx = await createApp({ storage: { path },
    node: { session: { model: { provider: "mock", model: "test" } } },
    ...(provider === undefined ? {} : { embedding: provider }) });
  contexts.push(ctx);
  const project = ctx.projects.create({ name: "Index", goal: null });
  await ctx.projectWorkspaces.create(project.id, root);
  return { ctx, project, root, path };
}

async function settled(ctx: Context): Promise<void> {
  await ctx.content.idle();
  await ctx.resourceIndex.idle();
}

async function close(ctx: Context): Promise<void> {
  contexts.splice(contexts.indexOf(ctx), 1);
  await ctx.fiber.dispose();
}
