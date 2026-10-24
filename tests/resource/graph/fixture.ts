import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "cordis";
import { createApp } from "../../../src/app.js";
import type { GraphConfig } from "../../../src/resource/graph/extraction.js";
import type { GenerateRequest, ModelEvent } from "../../../src/llm/types.js";
import type { GraphExtraction } from "../../../src/storage/graph.js";
import type { ProjectId } from "../../../src/brand/ids.js";

export interface InputChunk { readonly id: string; readonly text: string }
export type Handler = (chunks: readonly InputChunk[], request: GenerateRequest) => GraphExtraction | string | Promise<GraphExtraction | string>;
export const config: GraphConfig = { model: { provider: "graph-test", model: "test" } };
export const contexts: Context[] = [];
const roots: string[] = [];

export function adapter(handle: Handler = facts) {
  const requests: GenerateRequest[] = [];
  return { requests, async *stream(request: GenerateRequest): AsyncIterable<ModelEvent> {
    requests.push(request);
    const text = request.messages.at(-1)!.content[0]!;
    if (text.type !== "text") throw new Error("Missing chunks.");
    const value = await handle(JSON.parse(text.text) as InputChunk[], request);
    yield { type: "content-started", contentIndex: 0, contentType: "text" };
    yield { type: "content-delta", contentIndex: 0, contentType: "text", delta: typeof value === "string" ? value : JSON.stringify(value) };
    yield { type: "content-completed", contentIndex: 0, contentType: "text" };
    yield { type: "finished", reason: { kind: "stop" } };
  } };
}

export function facts(chunks: readonly InputChunk[]): GraphExtraction {
  return { entities: [{ id: "a", name: "Alice", type: "Person", chunkIds: chunks.map(chunk => chunk.id) },
    { id: "b", name: "Bob", type: "Person", chunkIds: chunks.map(chunk => chunk.id) }],
  relations: chunks.flatMap(chunk => [{ source: "a", target: "b", type: "KNOWS", chunkId: chunk.id },
    { source: "a", target: "b", type: "KNOWS", chunkId: chunk.id }]) };
}

export async function fixture(handle: Handler = facts, options: { persistent?: boolean; graph?: GraphConfig } = {}) {
  const root = await mkdtemp(join(tmpdir(), "navo-graph-"));
  roots.push(root);
  const workspace = join(root, "workspace");
  await mkdir(workspace);
  const path = options.persistent ? join(root, "navo.db") : ":memory:";
  const llm = adapter(handle);
  const ctx = await open(path, llm, options.graph ?? config);
  const project = ctx.projects.create({ name: "Graph", goal: null });
  await ctx.projectWorkspaces.create(project.id, workspace);
  return { ctx, llm, root, workspace, path, project };
}

export async function open(path: string, llm: ReturnType<typeof adapter>, graph: GraphConfig = config) {
  const ctx = await createApp({ storage: { path }, graph, embedding: {
    id: "test", model: "test", revision: null, dimension: 2, documentTemplateVersion: "d1", queryTemplateVersion: "q1",
    async embedMany({ inputs }) { return inputs.map(() => [1, 0]); },
  }, node: { session: { model: { provider: "mock", model: "test" } } } });
  contexts.push(ctx);
  ctx.llm.registerAdapter("graph-test", llm);
  return ctx;
}

export async function publish(ctx: Context, projectId: ProjectId, workspace: string, filename = "report.md", body = "Alice knows Bob.") {
  await writeFile(join(workspace, filename), body);
  const resource = await ctx.resources.publish({ projectId, owner: { kind: "main" }, sourceRef: filename,
    name: filename, description: "", type: "text/markdown" });
  await settle(ctx);
  return resource;
}

export async function settle(ctx: Context) { await ctx.content.idle(); await ctx.resourceIndex.idle(); await ctx.resourceGraph.idle(); }
export async function close(ctx: Context) { contexts.splice(contexts.indexOf(ctx), 1); await ctx.fiber.dispose(); }
export async function cleanup() {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
}
