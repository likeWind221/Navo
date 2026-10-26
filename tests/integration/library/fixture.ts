import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Context } from "cordis";
import { afterEach } from "vitest";
import { createApp } from "../../../src/app.js";
import { MockLLMAdapter, type MockLLMEntry } from "../../../src/llm/adapters/mock.js";
import type { GenerateRequest } from "../../../src/llm/types.js";
import type { EmbeddingProvider } from "../../../src/embedding/types.js";
import { adapter, settle } from "../../resource/graph/fixture.js";
import { documents, goal } from "../../../scripts/library/data.js";

const worlds: Array<{ close(): Promise<void>; root: string }> = [];

afterEach(async () => {
  for (const world of worlds.splice(0)) {
    await world.close();
    await rm(world.root, { recursive: true, force: true });
  }
});

export async function world() {
  const root = await mkdtemp(join(tmpdir(), "navo-f136-"));
  const workspace = join(root, "workspace");
  const intake = join(root, "intake");
  await mkdir(workspace);
  await mkdir(intake);
  const queue: MockLLMEntry[] = [];
  const requests: GenerateRequest[] = [];
  const graph = adapter(chunks => ({
    entities: [{ id: "a", name: "Atlas", type: "Candidate", chunkIds: chunks.map(chunk => chunk.id) },
      { id: "b", name: "Boreal", type: "Candidate", chunkIds: chunks.map(chunk => chunk.id) }],
    relations: chunks.map(chunk => ({ source: "a", target: "b", type: "COMPARED_WITH", chunkId: chunk.id })),
  }));
  const embedding: EmbeddingProvider = { id: "test", model: "test", revision: null, dimension: 2,
    documentTemplateVersion: "d1", queryTemplateVersion: "q1",
    async embedMany({ inputs }) { return inputs.map(() => [1, 0]); } };
  const open = async () => {
    const app = await createApp({ storage: { path: join(root, "navo.db") }, embedding,
      graph: { model: { provider: "graph-test", model: "test" } },
      runtime: { maxSteps: 24, maxModelRetries: 0 },
      tools: { file: { resolveFileEnvironment: async () => { throw new Error("Project binding required"); } } },
      node: { session: { model: { provider: "mock", model: "test" } } } });
    app.llm.registerAdapter("graph-test", graph);
    app.llm.registerAdapter("mock", { async *stream(request) {
      requests.push(request);
      const entry = queue.shift();
      if (entry === undefined) throw new Error("Unexpected task model request");
      yield* new MockLLMAdapter([entry]).stream(request);
    } });
    return app;
  };
  let app: Context = await open();
  const result = {
    root, workspace, requests, graph, embedding,
    get app() { return app; },
    enqueue(...entries: MockLLMEntry[]) { queue.push(...entries); },
    async close() { await app.fiber.dispose(); },
    async restart() {
      await app.fiber.dispose();
      app = await open();
      await settle(app);
    },
  };
  worlds.push(result);
  const project = app.projects.create({ name: "Library task acceptance", goal });
  await app.projectWorkspaces.create(project.id, workspace);
  const sources = [];
  for (const document of documents) {
    const path = join(intake, document.name);
    await writeFile(path, document.body);
    sources.push({ kind: "file" as const, path });
  }
  for await (const item of app.userResources.import({ projectId: project.id, requestId: "library_sources", sources }, new AbortController().signal)) {
    if (item.status !== "saved") throw new Error(`Import did not save ${item.name}`);
  }
  await settle(app);
  const resources = app.resources.listByProject(project.id);
  return { ...result, get app() { return app; }, project,
    resources, source: (name: string) => resources.find(resource => resource.name === name)! };
}

export function submission(resourceId: string | undefined, summary: string) {
  return { summary, resource_ids: resourceId === undefined ? [] : [resourceId], criteria: [1, 2].map(criterion_index => ({
    criterion_index, satisfied: true, note: summary,
  })), remaining: [] };
}
