import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it, vi } from "vitest";
import type { Context } from "cordis";
import { createApp } from "../../src/app.js";
import { createEmbeddingProvider, resolveEmbeddingConfig } from "../../src/embedding/provider.js";

let app: Context | undefined;
let root: string | undefined;

afterEach(async () => {
  await app?.fiber.dispose();
  if (root !== undefined) await rm(root, { recursive: true, force: true });
});

it("rebuilds Qwen indexes for OpenRouter, isolates private evidence and reuses published vectors after restart", async () => {
  root = await mkdtemp(join(tmpdir(), "navo-embedding-adapters-"));
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const request = vi.fn<typeof fetch>(async (_url, init) => {
    const body = JSON.parse(String(init?.body)) as { model: string; input: string[] };
    const dimension = body.model === "Qwen3-Embedding-4B" ? 2560 : 2048;
    return Response.json({ data: body.input.map((text, index) => ({ index,
      embedding: Array.from({ length: dimension }, (_item, component) => component === (text.includes("database") ? 0 : 1) ? 1 : 0),
    })) });
  });
  const storage = { path: join(root, "navo.db") };
  const nodeConfig = { session: { model: { provider: "unused", model: "unused" } } };
  const qwen = resolveEmbeddingConfig({ EMBEDDING_BASE_URL: "http://qwen.test/v1" })!;
  app = await createApp({ storage, node: nodeConfig, embedding: createEmbeddingProvider(qwen, { fetch: request }) });
  const project = app.projects.create({ name: "Embedding migration", goal: null });
  await app.projectWorkspaces.create(project.id, workspace);
  await writeFile(join(workspace, "shared.md"), "database transactions preserve changes");
  await writeFile(join(workspace, "private.md"), "private penguin evidence");
  const shared = await app.resources.publish({ projectId: project.id, owner: { kind: "main" },
    sourceRef: "shared.md", name: "shared", description: "", type: "text/markdown" });
  app.resources.setAccess({ projectId: project.id, resourceId: shared.id, actor: { kind: "main" },
    expectedRevision: shared.revision, access: { kind: "public" } });
  const secret = await app.resources.publish({ projectId: project.id, owner: { kind: "main" },
    sourceRef: "private.md", name: "private", description: "", type: "text/markdown" });
  const node = app.nodes.create({ projectId: project.id, objective: { title: "Read shared sources",
    description: "Read", acceptanceCriteria: ["No private evidence"] } });
  await settle(app);
  expect(app.storage.atomic(tx => tx.listIndexBuilds("active"))).toHaveLength(2);
  await app.fiber.dispose();
  const openrouter = resolveEmbeddingConfig({ EMBEDDING_PROVIDER: "openrouter", OPENROUTER_API_KEY: "key" })!;
  const config = { storage, node: nodeConfig, embedding: createEmbeddingProvider(openrouter, { fetch: request }) };
  const beforeMigration = request.mock.calls.length;
  app = await createApp(config);
  await settle(app);
  expect(request.mock.calls.length - beforeMigration).toBe(2);
  const builds = app.storage.atomic(tx => tx.listIndexBuilds());
  expect(builds.filter(build => build.embedding_provider === "openai-compatible").map(build => build.status))
    .toEqual(["superseded", "superseded"]);
  const active = builds.filter(build => build.status === "active");
  expect(active).toHaveLength(2);
  expect(active.every(build => build.embedding_provider === "openrouter" && build.embedding_dimension === 2048
    && build.document_template_version === "nemotron35-passage-v1")).toBe(true);
  const visible = await app.retrieval.search({ projectId: project.id, viewer: { kind: "node", nodeId: node.node.id },
    query: "private penguin", mode: "vector", topK: 3 });
  expect(visible.map(hit => hit.resourceId)).toEqual([shared.id]);
  expect(JSON.stringify(visible)).not.toContain(secret.id);
  expect(JSON.stringify(visible)).not.toContain("private penguin");
  const beforeRestart = request.mock.calls.length;
  const buildIds = active.map(build => build.build_id).sort();
  await app.fiber.dispose();
  app = await createApp(config);
  await settle(app);
  expect(request.mock.calls.length).toBe(beforeRestart);
  expect(app.storage.atomic(tx => tx.listIndexBuilds("active")).map(build => build.build_id).sort()).toEqual(buildIds);
  const hits = await app.retrieval.search({ projectId: project.id, viewer: { kind: "main" }, query: "database", mode: "vector" });
  expect(hits[0]?.resourceId).toBe(shared.id);
  expect(request.mock.calls.length).toBe(beforeRestart + 1);
});

async function settle(ctx: Context): Promise<void> {
  await ctx.content.idle();
  await ctx.resourceIndex.idle();
  await ctx.resourceGraph.idle();
}
