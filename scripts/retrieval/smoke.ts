import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { createApp } from "../../src/app.js";
import { OpenAIEmbeddingProvider } from "../../src/embedding/openai.js";
import type { ProjectId } from "../../src/brand/ids.js";
import type { ProjectResource } from "../../src/resource/model.js";
import type { RetrievalResult } from "../../src/resource/retrieval/types.js";

const root = await mkdtemp(join(tmpdir(), "navo-retrieval-smoke-"));
const workspace = join(root, "workspace");
await mkdir(workspace);
const started = performance.now();
const signal = AbortSignal.timeout(180_000);
const calls: { inputs: number; milliseconds: number; status: number }[] = [];
const checks: { query: string; names: string[]; milliseconds: number }[] = [];
const provider = new OpenAIEmbeddingProvider({
  endpoint: process.env.EMBEDDING_BASE_URL ?? "http://192.168.99.2:8081/v1",
  model: process.env.EMBEDDING_MODEL ?? "Qwen3-Embedding-4B",
  policy: { maxAttempts: 1, timeoutMs: 15_000 },
  fetch: async (url, init) => {
    assert(calls.length < 10, "Embedding request budget exhausted");
    const call = { inputs: (JSON.parse(String(init?.body)) as { input: string[] }).input.length,
      milliseconds: 0, status: 0 };
    calls.push(call);
    const before = performance.now();
    const response = await fetch(url, { ...init,
      signal: init?.signal ? AbortSignal.any([signal, init.signal]) : signal });
    call.milliseconds = performance.now() - before;
    call.status = response.status;
    return response;
  },
});
const config = { storage: { path: join(root, "navo.db") }, embedding: provider,
  node: { session: { model: { provider: "unused", model: "unused" } } } };
let ctx = await createApp(config);
let failure: unknown;
try {
  const project = ctx.projects.create({ name: "Embedding smoke", goal: null });
  await ctx.projectWorkspaces.create(project.id, workspace);
  const documents = [
    { name: "penguin.md", body: "# 企鹅研究\n\n企鹅生活在南极等地区，是不会飞的鸟类，擅长游泳，主要捕食鱼和磷虾。", public: true },
    { name: "database.md", body: "# SQLite 事务\n\nSQLite 是嵌入式关系数据库。事务通过提交保存修改，通过回滚撤销修改，提供原子性和持久性。", public: true },
    { name: "private.md", body: "# 私有实验记录\n\n秘密项目代号紫色海豚，内部预算七百万元，负责人李明。", public: false },
  ];
  const resources: ProjectResource[] = [];
  for (const document of documents) {
    await writeFile(join(workspace, document.name), document.body);
    let resource = await ctx.resources.publish({ projectId: project.id, owner: { kind: "main" },
      sourceRef: document.name, name: document.name, description: "smoke", type: "text/markdown" });
    if (document.public) resource = ctx.resources.setAccess({ projectId: project.id, resourceId: resource.id,
      actor: { kind: "main" }, expectedRevision: resource.revision, access: { kind: "public" } });
    resources.push(resource);
    await settle();
    assert.equal(ctx.resourceIndex.status(project.id, resource.id).status, "active");
  }
  const builds = ctx.storage.atomic(tx => tx.listIndexBuilds("active"));
  assert.equal(builds.length, 3);
  assert(builds.every(build => build.embedding_dimension === 2560 && build.embedding_model === provider.model));
  const queries = [
    { query: "哪种鸟不会飞却擅长在南极游泳？", expected: "penguin.md", mode: "vector" },
    { query: "How can a database undo changes in a transaction?", expected: "database.md", mode: "vector" },
    { query: "数据库如何保证修改在提交后保存？", expected: "database.md", mode: "hybrid" },
    { query: "秘密项目紫色海豚的预算是多少？", expected: "private.md", mode: "hybrid" },
  ] as const;
  for (const query of queries) {
    const before = performance.now();
    const hits = await ctx.retrieval.search({ projectId: project.id, viewer: { kind: "main" },
      query: query.query, mode: query.mode, topK: 3, signal });
    checks.push({ query: query.query, names: hits.map(hit => hit.name), milliseconds: performance.now() - before });
    assert.equal(hits[0]?.name, query.expected);
    verifySources(project.id, hits);
  }
  const node = ctx.nodes.create({ projectId: project.id, objective: {
    title: "Read public documents", description: "smoke", acceptanceCriteria: ["No private sources"] } });
  const visible = await ctx.retrieval.search({ projectId: project.id, viewer: { kind: "node", nodeId: node.node.id },
    query: "秘密项目紫色海豚的预算是多少？", topK: 3, signal });
  assert(visible.length > 0);
  assert(visible.every(hit => hit.resourceId !== resources[2]!.id && !JSON.stringify(hit).includes("七百万元")));
  const callsBeforeRestart = calls.length;
  const buildIds = builds.map(build => build.build_id).sort();
  await ctx.fiber.dispose();
  ctx = await createApp(config);
  await settle();
  assert.equal(calls.length, callsBeforeRestart);
  assert.deepEqual(ctx.storage.atomic(tx => tx.listIndexBuilds("active")).map(build => build.build_id).sort(), buildIds);
  const reopened = await ctx.retrieval.search({ projectId: project.id, viewer: { kind: "main" },
    query: queries[0].query, mode: "vector", topK: 3, signal });
  assert.equal(reopened[0]?.name, "penguin.md");
  verifySources(project.id, reopened);
} catch (error) {
  failure = error;
  throw error;
} finally {
  await ctx.fiber.dispose();
  const report = { passed: failure === undefined, error: failure instanceof Error ? failure.message : String(failure ?? ""),
    root, model: provider.model, dimension: provider.dimension, calls, checks,
    milliseconds: performance.now() - started, boundary: "No generation model or extracted graph; hybrid has vector evidence only." };
  await writeFile(join(root, "result.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
}

async function settle() {
  await ctx.content.idle();
  await ctx.resourceIndex.idle();
  await ctx.resourceGraph.idle();
}

function verifySources(projectId: ProjectId, hits: readonly RetrievalResult[]) {
  for (const hit of hits) {
    const content = ctx.content.read(projectId, hit.resourceId);
    assert(content?.body);
    for (const chunk of hit.chunks) {
      assert.equal(content.body.slice(chunk.startOffsetUtf16, chunk.endOffsetUtf16), chunk.text);
      assert.equal(chunk.assetGeneration, hit.assetGeneration);
      assert(Number.isFinite(chunk.fusionScore));
      assert(chunk.paths.length === 0 && chunk.matches.every(route => route === "vector"));
    }
  }
}
