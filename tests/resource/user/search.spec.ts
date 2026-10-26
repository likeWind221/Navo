import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Context } from "cordis";
import { createApp } from "../../../src/app.js";
import { createResourceId } from "../../../src/brand/ids.js";
import type { EmbeddingProvider } from "../../../src/embedding/types.js";
import { pendingContent } from "../../../src/resource/content/store.js";
import { chunkText } from "../../../src/resource/index/chunker.js";
import { parseResourceSearchResult } from "../../../rpc/resource/search/validation.js";
import { temporaryDatabase } from "../../helpers/storage.js";

const contexts: Context[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it("searches the trusted User scope including Node-private resources and paginates once", async () => {
  let embeds = 0;
  const provider = embedding(() => { embeds++; });
  const { ctx, project, root } = await fixture(provider);
  const node = ctx.nodes.create({ projectId: project.id, objective: { title: "Reader", description: "Read", acceptanceCriteria: ["Read"] } });
  await writeFile(join(root, "main.md"), "shared evidence", "utf8");
  await writeFile(join(root, "secret.md"), "private evidence", "utf8");
  await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "main.md",
    name: "Main", description: "Shared", type: "text/markdown" });
  await ctx.resources.publish({ projectId: project.id, owner: { kind: "node", nodeId: node.node.id }, sourceRef: "secret.md",
    name: "Secret", description: "Private", type: "text/markdown" });
  await ctx.content.idle();
  await ctx.resourceIndex.idle();

  const first = await ctx.userResources.search({ projectId: project.id, query: "evidence", limit: 1 }, new AbortController().signal);
  expect(first.status).toBe("ready");
  expect(first.results).toHaveLength(1);
  expect(first.nextOffset).toBe(1);
  expect(first.searchToken).toEqual(expect.any(String));
  const second = await ctx.userResources.search({ projectId: project.id, query: "evidence", limit: 1,
    offset: first.nextOffset!, searchToken: first.searchToken! }, new AbortController().signal);
  expect(second.results).toHaveLength(1);
  expect(new Set([first.results[0]!.name, second.results[0]!.name])).toEqual(new Set(["Main", "Secret"]));
  expect(embeds).toBe(1);
});

it("rejects a changed catalog and a token rewritten for another Project", async () => {
  const { ctx, project, root } = await fixture(embedding());
  await writeFile(join(root, "search.md"), "searchable", "utf8");
  await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "search.md",
    name: "Search", description: "Search", type: "text/markdown" });
  await ctx.content.idle();
  await ctx.resourceIndex.idle();
  const first = await ctx.userResources.search({ projectId: project.id, query: "search", limit: 1 }, new AbortController().signal);
  const token = first.searchToken!;
  const other = ctx.projects.create({ name: "Other", goal: null });
  await expect(ctx.userResources.search({ projectId: project.id, query: "search", limit: 1, searchToken: token, offset: 1 }, new AbortController().signal))
    .resolves.toBeDefined();
  ctx.userResources.update({ projectId: project.id, resourceId: createResourceId(first.results[0]!.resourceId), expectedRevision: 1, changes: { description: "changed" } });
  await expect(ctx.userResources.search({ projectId: project.id, query: "search", limit: 1, searchToken: token, offset: 1 }, new AbortController().signal))
    .rejects.toMatchObject({ code: "search-changed" });
  const rewritten = JSON.stringify({ ...JSON.parse(token) as Record<string, unknown>, projectId: other.id });
  await expect(ctx.userResources.search({ projectId: other.id, query: "search", limit: 1, searchToken: rewritten, offset: 1 }, new AbortController().signal))
    .rejects.toMatchObject({ code: "search-expired" });
});

it("expires snapshots after five minutes and evicts the oldest of sixteen operations", async () => {
  const { ctx, project, root } = await fixture(embedding());
  await writeFile(join(root, "operations.md"), "operations", "utf8");
  await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "operations.md",
    name: "Operations", description: "", type: "text/markdown" });
  await ctx.content.idle();
  await ctx.resourceIndex.idle();
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    const tokens: string[] = [];
    for (let index = 0; index < 17; index++) {
      const result = await ctx.userResources.search({ projectId: project.id, query: `operation-${index}` }, new AbortController().signal);
      tokens.push(result.searchToken!);
    }
    await expect(ctx.userResources.search({ projectId: project.id, query: "operation-0", searchToken: tokens[0]!, offset: 1 }, new AbortController().signal))
      .rejects.toMatchObject({ code: "search-expired" });
    vi.advanceTimersByTime(5 * 60 * 1000 + 1);
    await expect(ctx.userResources.search({ projectId: project.id, query: "operation-16", searchToken: tokens[16]!, offset: 1 }, new AbortController().signal))
      .rejects.toMatchObject({ code: "search-expired" });
  } finally {
    vi.useRealTimers();
  }
});

it("rejects a page when the resource generation or Graph build fact changes", async () => {
  const { ctx, project, root } = await fixture(embedding());
  await writeFile(join(root, "generation.md"), "generation", "utf8");
  const resource = await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "generation.md",
    name: "Generation", description: "", type: "text/markdown" });
  await ctx.content.idle();
  await ctx.resourceIndex.idle();
  const first = await ctx.userResources.search({ projectId: project.id, query: "generation" }, new AbortController().signal);
  await writeFile(join(root, "replacement.md"), "replacement", "utf8");
  await ctx.userResources.replace({ projectId: project.id, resourceId: resource.id, expectedRevision: resource.revision }, join(root, "replacement.md"));
  await expect(ctx.userResources.search({ projectId: project.id, query: "generation", searchToken: first.searchToken!, offset: 1 }, new AbortController().signal))
    .rejects.toMatchObject({ code: "search-changed" });
  await ctx.content.idle();
  await ctx.resourceIndex.idle();

  const second = await ctx.userResources.search({ projectId: project.id, query: "replacement" }, new AbortController().signal);
  const active = ctx.storage.atomic(tx => tx.listIndexBuilds("active").find(build => build.resource_id === resource.id));
  expect(active).toBeDefined();
  ctx.storage.atomic(tx => tx.createGraphBuild({ build_id: "graph-snapshot-test", project_id: project.id, resource_id: resource.id,
    source_asset_generation: active!.source_asset_generation, source_build_id: active!.build_id, pipeline_version: "test",
    status: "building", next_ordinal: 0, error_code: null }));
  await expect(ctx.userResources.search({ projectId: project.id, query: "replacement", searchToken: second.searchToken!, offset: 1 }, new AbortController().signal))
    .rejects.toMatchObject({ code: "search-changed" });
});

it("keeps a maximum-length query token within the public RPC result bound", async () => {
  const { ctx, project, root } = await fixture(embedding());
  await writeFile(join(root, "long.md"), "long query", "utf8");
  await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "long.md",
    name: "Long", description: "", type: "text/markdown" });
  await ctx.content.idle();
  await ctx.resourceIndex.idle();
  const result = await ctx.userResources.search({ projectId: project.id, query: "q".repeat(4096), limit: 1 }, new AbortController().signal);
  expect(result.searchToken!.length).toBeLessThanOrEqual(256);
  expect(parseResourceSearchResult(result)).toMatchObject({ query: "q".repeat(4096), searchToken: result.searchToken });
});

it("filters a folder and its descendants while preserving locator fields", async () => {
  const { ctx, project, root } = await fixture(embedding());
  await writeFile(join(root, "inside.md"), "folder evidence", "utf8");
  await writeFile(join(root, "outside.md"), "folder evidence", "utf8");
  const inside = await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "inside.md",
    name: "Inside", description: "Folder", type: "text/markdown" });
  await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "outside.md",
    name: "Outside", description: "Folder", type: "text/markdown" });
  ctx.userResources.createFolder(project.id, "docs");
  ctx.userResources.createFolder(project.id, "docs/sub");
  ctx.userResources.organizeResource({ projectId: project.id, resourceId: inside.id, expectedRevision: inside.revision, folder: "docs/sub" });
  await ctx.content.idle();
  await ctx.resourceIndex.idle();
  const result = await ctx.userResources.search({ projectId: project.id, query: "evidence", folder: "docs", limit: 100 }, new AbortController().signal);
  expect(result.status).toBe("ready");
  expect(result.results.map(item => item.name)).toEqual(["Inside"]);
  expect(result.results[0]?.chunks[0]).toMatchObject({ text: "folder evidence", startOffsetUtf16: 0, endOffsetUtf16: 15 });
});

it("bounds long Markdown headings only in the User projection", async () => {
  const { ctx, project, root } = await fixture(embedding());
  const heading = "H".repeat(600);
  const source = `# ${heading}\n\nheading evidence`;
  expect(chunkText({ text: source, type: "text/markdown" })[0]?.headingPath[0]).toHaveLength(600);
  await writeFile(join(root, "heading.md"), source, "utf8");
  await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "heading.md",
    name: "Heading", description: "", type: "text/markdown" });
  await ctx.content.idle();
  await ctx.resourceIndex.idle();
  const result = await ctx.userResources.search({ projectId: project.id, query: "heading", limit: 1 }, new AbortController().signal);
  expect(result.results[0]?.chunks[0]?.headingPath[0]).toHaveLength(512);
  expect(result.results[0]?.chunks[0]?.headingPath[0]?.endsWith("...")).toBe(true);
});

it("distinguishes embedding configuration from an empty result", async () => {
  const { ctx, project, root } = await fixture();
  await writeFile(join(root, "search.md"), "searchable", "utf8");
  await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "search.md",
    name: "Search", description: "Search", type: "text/markdown" });
  await ctx.content.idle();
  const unavailable = await ctx.userResources.search({ projectId: project.id, query: "search" }, new AbortController().signal);
  expect(unavailable).toMatchObject({ status: "retrieval-unavailable", errorCode: "embedding-unconfigured", availability: { searchable: 0, unindexed: 1 } });

  const emptyProject = ctx.projects.create({ name: "Empty", goal: null });
  const empty = await ctx.userResources.search({ projectId: emptyProject.id, query: "unmatched" }, new AbortController().signal);
  expect(empty).toMatchObject({ status: "no-results", errorCode: null, availability: { searchable: 0, pending: 0, failed: 0, unindexed: 0 } });
});

it("distinguishes pending and failed content without issuing a query embedding", async () => {
  let embeds = 0;
  const { ctx, project, root } = await fixture(embedding(() => { embeds++; }));
  await writeFile(join(root, "pending.md"), "pending", "utf8");
  const resource = await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "pending.md",
    name: "Pending", description: "", type: "text/markdown" });
  await ctx.content.stop();
  ctx.storage.atomic(tx => {
    tx.bumpCatalogVersion(project.id);
    tx.putResourceContent(pendingContent(project.id, resource.id, resource.assetGeneration));
  });
  const pending = await ctx.userResources.search({ projectId: project.id, query: "pending" }, new AbortController().signal);
  expect(pending).toMatchObject({ status: "content-unavailable", errorCode: "content-unavailable", availability: { pending: 1 } });
  ctx.storage.atomic(tx => {
    tx.bumpCatalogVersion(project.id);
    tx.putResourceContent({ ...pendingContent(project.id, resource.id, resource.assetGeneration), status: "failed", error_code: "read-failed", error_message: "failed" });
  });
  const failed = await ctx.userResources.search({ projectId: project.id, query: "pending" }, new AbortController().signal);
  expect(failed).toMatchObject({ status: "failed", errorCode: "search-failed", availability: { failed: 1 } });
  expect(embeds).toBe(0);
});

it("propagates cancellation without creating a search operation", async () => {
  let resolveStarted!: () => void;
  const started = new Promise<void>(resolve => { resolveStarted = resolve; });
  const provider = embedding();
  provider.embedMany = async ({ inputs, kind, signal }) => {
    if (kind !== "query") return inputs.map(() => [1, 0]);
    resolveStarted();
    return new Promise<readonly number[][]>((_resolve, reject) => {
      signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };
  const { ctx, project, root } = await fixture(provider);
  await writeFile(join(root, "cancel.md"), "cancel", "utf8");
  await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "cancel.md",
    name: "Cancel", description: "", type: "text/markdown" });
  await ctx.content.idle();
  await ctx.resourceIndex.idle();
  const controller = new AbortController();
  const search = ctx.userResources.search({ projectId: project.id, query: "cancel" }, controller.signal);
  await started;
  controller.abort();
  await expect(search).rejects.toMatchObject({ name: "AbortError" });
});

it("rejects an in-flight search when User resource facts change during embedding", async () => {
  let resolveStarted!: () => void;
  let releaseQuery!: () => void;
  const started = new Promise<void>(resolve => { resolveStarted = resolve; });
  const provider = embedding();
  provider.embedMany = async ({ inputs, kind }) => {
    if (kind !== "query") return inputs.map(() => [1, 0]);
    resolveStarted();
    await new Promise<void>(resolve => { releaseQuery = resolve; });
    return inputs.map(() => [1, 0]);
  };
  const { ctx, project, root } = await fixture(provider);
  await writeFile(join(root, "inflight.md"), "inflight", "utf8");
  const resource = await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "inflight.md",
    name: "Inflight", description: "", type: "text/markdown" });
  await ctx.content.idle();
  await ctx.resourceIndex.idle();
  const search = ctx.userResources.search({ projectId: project.id, query: "inflight" }, new AbortController().signal);
  await started;
  ctx.userResources.update({ projectId: project.id, resourceId: resource.id, expectedRevision: resource.revision, changes: { description: "changed" } });
  releaseQuery();
  await expect(search).rejects.toMatchObject({ code: "search-changed" });
});

async function fixture(provider?: EmbeddingProvider) {
  const path = await temporaryDatabase(roots, "navo-user-search-");
  const ctx = await createApp({ storage: { path }, node: { session: { model: { provider: "mock", model: "test" } } },
    ...(provider === undefined ? {} : { embedding: provider }) });
  contexts.push(ctx);
  const project = ctx.projects.create({ name: "Search", goal: null });
  const root = join(dirname(path), "workspace");
  await mkdir(root);
  await ctx.projectWorkspaces.create(project.id, root);
  return { ctx, project, root };
}

function embedding(onEmbed: () => void = () => undefined): EmbeddingProvider {
  return { id: "mock", model: "search", revision: null, dimension: 2, documentTemplateVersion: "document-v1", queryTemplateVersion: "query-v1",
    embedMany: async ({ inputs, kind }) => { if (kind === "query") onEmbed(); return inputs.map(() => [1, 0]); } };
}
