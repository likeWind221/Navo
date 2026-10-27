import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { afterEach, expect, it } from "vitest";
import { createApp } from "../../../src/app.js";
import type { EmbeddingProvider } from "../../../src/embedding/types.js";
import { CHUNKER_VERSION } from "../../../src/resource/index/chunker.js";
import { VECTOR_ENCODING_VERSION } from "../../../src/resource/index/vector.js";
import { pendingContent } from "../../../src/resource/content/store.js";
import { queryUserResources } from "../../../src/resource/user/query.js";
import { temporaryDatabase } from "../../helpers/storage.js";
import type { Context } from "cordis";

const contexts: Context[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

it("queries the trusted User project scope, including Node-private resources", async () => {
  const { ctx, project, root } = await fixture();
  const node = ctx.nodes.create({ projectId: project.id, objective: { title: "Reader", description: "Read", acceptanceCriteria: ["Read"] } });
  await writeFile(join(root, "main.md"), "main", "utf8");
  await writeFile(join(root, "secret.md"), "secret", "utf8");
  const main = await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "main.md",
    name: "Main note", description: "User-visible", type: "text/markdown" });
  const secret = await ctx.resources.publish({ projectId: project.id, owner: { kind: "node", nodeId: node.node.id }, sourceRef: "secret.md",
    name: "Node secret", description: "Private evidence", type: "text/markdown" });
  await ctx.content.idle();
  const result = queryUserResources(ctx, { projectId: project.id, query: "evidence" }, new AbortController().signal);
  expect(result.resources.map(item => item.resource.id)).toEqual([secret.id]);
  expect(result.resources[0]?.content?.status).toBe("ready");
  expect(result.resources[0]?.index.status).toBe("waiting-config");
  expect(ctx.resources.listVisible(project.id, { kind: "node", nodeId: node.node.id }).map(resource => resource.id)).toEqual([secret.id]);
  expect(main.id).not.toBe(secret.id);
});

it("filters descendants, paginates by stable path, and rejects changed scope", async () => {
  const { ctx, project, root } = await fixture();
  await writeFile(join(root, "one.md"), "one", "utf8");
  await writeFile(join(root, "two.md"), "two", "utf8");
  const first = await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "one.md",
    name: "One", description: "Needle", type: "text/markdown" });
  const second = await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "two.md",
    name: "Two", description: "Needle", type: "text/markdown" });
  ctx.userResources.createFolder(project.id, "docs");
  ctx.userResources.createFolder(project.id, "docs/sub");
  ctx.userResources.organizeResource({ projectId: project.id, resourceId: first.id, expectedRevision: first.revision, folder: "docs" });
  ctx.userResources.organizeResource({ projectId: project.id, resourceId: second.id, expectedRevision: second.revision, folder: "docs/sub" });
  const page = queryUserResources(ctx, { projectId: project.id, query: "needle", folder: "docs", limit: 1 }, new AbortController().signal);
  expect(page.resources).toHaveLength(1);
  expect(page.resources[0]?.resource.libraryPath).toBe("docs/one.md");
  expect(page.nextOffset).toBe(1);
  const next = queryUserResources(ctx, { projectId: project.id, query: "needle", folder: "docs", limit: 1,
    offset: page.nextOffset!, expectedChangeToken: page.changeToken }, new AbortController().signal);
  expect(next.resources[0]?.resource.libraryPath).toBe("docs/sub/two.md");
  expect(() => queryUserResources(ctx, { projectId: project.id, query: "other", folder: "docs", limit: 1,
    expectedChangeToken: page.changeToken }, new AbortController().signal)).toThrow(expect.objectContaining({ code: "query-changed" }));
  ctx.userResources.update({ projectId: project.id, resourceId: first.id, expectedRevision: 2,
    changes: { description: "Changed" } });
  expect(() => queryUserResources(ctx, { projectId: project.id, query: "needle", folder: "docs", limit: 1,
    offset: 1, expectedChangeToken: page.changeToken }, new AbortController().signal)).toThrow(expect.objectContaining({ code: "query-changed" }));
});

it("keeps catalog versions atomic and does not advance on a no-op", async () => {
  const { ctx, project, root } = await fixture();
  const before = ctx.storage.atomic(tx => tx.getCatalogVersion(project.id));
  expect(() => ctx.storage.atomic(tx => {
    tx.bumpCatalogVersion(project.id);
    tx.insertFolder({ projectId: project.id, path: "docs", createdAt: "now", updatedAt: "now" });
    tx.insertFolder({ projectId: project.id, path: "docs", createdAt: "now", updatedAt: "now" });
  })).toThrow();
  expect(ctx.storage.atomic(tx => tx.getCatalogVersion(project.id))).toBe(before);
  await writeFile(join(root, "noop.md"), "noop", "utf8");
  const resource = await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "noop.md",
    name: "No-op", description: "same", type: "text/markdown" });
  const version = ctx.storage.atomic(tx => tx.getCatalogVersion(project.id));
  ctx.userResources.update({ projectId: project.id, resourceId: resource.id, expectedRevision: resource.revision, changes: { description: "same" } });
  expect(ctx.storage.atomic(tx => tx.getCatalogVersion(project.id))).toBe(version);
});

it("rejects a missing project, permits the existing archived read scope, and honors cancellation", async () => {
  const { ctx, project } = await fixture();
  expect(() => queryUserResources(ctx, { projectId: "missing-project" as typeof project.id }, new AbortController().signal))
    .toThrow(expect.objectContaining({ code: "project-unavailable" }));
  const resource = ctx.resources.listByProject(project.id);
  ctx.projects.archive(project.id, "Pause");
  expect(queryUserResources(ctx, { projectId: project.id }, new AbortController().signal).resources.map(item => item.resource.id))
    .toEqual(resource.map(item => item.id));
  const controller = new AbortController();
  controller.abort();
  expect(() => queryUserResources(ctx, { projectId: project.id }, controller.signal)).toThrow(expect.objectContaining({ name: "AbortError" }));
});

it("keeps the token after restart with the same index configuration and changes it when configuration changes", async () => {
  const path = await temporaryDatabase(roots, "navo-query-restart-");
  const root = join(dirname(path), "workspace");
  await mkdir(root);
  await writeFile(join(root, "report.md"), "report", "utf8");
  const first = await open(path, root, provider("model-a"));
  const project = first.projects.create({ name: "Query", goal: null });
  await first.projectWorkspaces.create(project.id, root);
  await first.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "report.md",
    name: "Report", description: "Stable", type: "text/markdown" });
  await first.content.idle();
  await first.resourceIndex.idle();
  const token = queryUserResources(first, { projectId: project.id }, new AbortController().signal).changeToken;
  await close(first);
  const same = await open(path, root, provider("model-a"));
  expect(queryUserResources(same, { projectId: project.id, expectedChangeToken: token }, new AbortController().signal).changeToken).toBe(token);
  await close(same);
  const changed = await open(path, root, provider("model-b"));
  expect(queryUserResources(changed, { projectId: project.id }, new AbortController().signal).resources[0]?.index.status).toBe("stale");
  expect(() => queryUserResources(changed, { projectId: project.id, expectedChangeToken: token }, new AbortController().signal))
    .toThrow(expect.objectContaining({ code: "query-changed" }));
});

it("reports only current compatible index states", async () => {
  const embedding = provider("model-state");
  const { ctx, project, root } = await fixture(embedding);
  await writeFile(join(root, "state.md"), "state", "utf8");
  const resource = await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" }, sourceRef: "state.md",
    name: "State", description: "", type: "text/markdown" });
  await ctx.content.idle();
  await ctx.resourceIndex.stop();
  const now = new Date().toISOString();
  const build = (buildId: string, status: "building" | "failed", generation = resource.assetGeneration) => ({
    build_id: buildId, project_id: project.id, resource_id: resource.id, source_asset_generation: generation, status,
    chunker_version: CHUNKER_VERSION, embedding_provider: embedding.id, embedding_model: embedding.model,
    embedding_revision: embedding.revision, embedding_dimension: embedding.dimension,
    document_template_version: embedding.documentTemplateVersion, query_template_version: embedding.queryTemplateVersion,
    vector_encoding_version: VECTOR_ENCODING_VERSION, expected_chunk_count: 0, attempt_count: 0,
    error_code: status === "failed" ? "index-failed" : null, error_message: status === "failed" ? "failed" : null,
    created_at: now, updated_at: now,
  } as const);
  ctx.storage.atomic(tx => tx.createIndexBuild(build("building", "building"), []));
  expect(queryUserResources(ctx, { projectId: project.id }, new AbortController().signal).resources[0]?.index.status).toBe("building");
  ctx.storage.atomic(tx => tx.publishIndexBuild("building"));
  expect(queryUserResources(ctx, { projectId: project.id }, new AbortController().signal).resources[0]?.index.status).toBe("active");
  ctx.storage.atomic(tx => {
    tx.supersedeIndexBuild("building");
    tx.createIndexBuild(build("failed", "failed"), []);
  });
  expect(queryUserResources(ctx, { projectId: project.id }, new AbortController().signal).resources[0]?.index.status).toBe("failed");
  await writeFile(join(root, "replacement.md"), "replacement", "utf8");
  const replaced = await ctx.resources.replace({ projectId: project.id, resourceId: resource.id, actor: { kind: "main" },
    expectedRevision: resource.revision, sourceRef: "replacement.md" });
  await ctx.content.stop();
  ctx.storage.atomic(tx => {
    tx.bumpCatalogVersion(project.id);
    tx.putResourceContent(pendingContent(project.id, resource.id, replaced.assetGeneration));
  });
  const pending = queryUserResources(ctx, { projectId: project.id }, new AbortController().signal).resources[0]!;
  expect(pending.content?.status).toBe("pending");
  expect(pending.index.status).toBe("absent");
  ctx.storage.atomic(tx => {
    tx.bumpCatalogVersion(project.id);
    tx.putResourceContent({ ...pendingContent(project.id, resource.id, replaced.assetGeneration),
      status: "failed", error_code: "read_failed", error_message: "failed" });
  });
  const failed = queryUserResources(ctx, { projectId: project.id }, new AbortController().signal).resources[0]!;
  expect(failed.content?.status).toBe("failed");
  expect(failed.index.status).toBe("absent");
  ctx.storage.atomic(tx => {
    tx.bumpCatalogVersion(project.id);
    tx.putResourceContent({ ...pendingContent(project.id, resource.id, replaced.assetGeneration),
      status: "ready", body: "replacement", extractor_version: "test" });
  });
  expect(queryUserResources(ctx, { projectId: project.id }, new AbortController().signal).resources[0]?.index.status).toBe("stale");
});

async function fixture(provider?: EmbeddingProvider) {
  const path = await temporaryDatabase(roots, "navo-user-query-");
  const ctx = await open(path, undefined, provider);
  const project = ctx.projects.create({ name: "Query", goal: null });
  const root = join(dirname(path), "workspace");
  await mkdir(root);
  await ctx.projectWorkspaces.create(project.id, root);
  return { ctx, project, root };
}

async function open(path: string, root: string | undefined, embedding?: EmbeddingProvider): Promise<Context> {
  const ctx = await createApp({ storage: { path }, node: { session: { model: { provider: "mock", model: "test" } } },
    ...(embedding === undefined ? {} : { embedding }) });
  contexts.push(ctx);
  if (root !== undefined) {
    const project = [...ctx.projects.list()][0];
    if (project !== undefined && await ctx.projectWorkspaces.get(project.id) === undefined) await ctx.projectWorkspaces.create(project.id, root);
  }
  return ctx;
}

async function close(ctx: Context): Promise<void> {
  contexts.splice(contexts.indexOf(ctx), 1);
  await ctx.fiber.dispose();
}

function provider(model: string): EmbeddingProvider {
  return { id: "mock", model, revision: null, dimension: 2, documentTemplateVersion: "document-v1", queryTemplateVersion: "query-v1",
    embedMany: async ({ inputs }) => inputs.map(() => [1, 0]) };
}
