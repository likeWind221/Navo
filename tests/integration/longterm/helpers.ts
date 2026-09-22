import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach } from "vitest";
import { createApp } from "../../../src/app.js";
import { createNodeId } from "../../../src/brand/ids.js";
import type { NodeId, ProjectId } from "../../../src/brand/ids.js";
import { MockLLMAdapter } from "../../../src/llm/adapters/mock.js";
import { scenario } from "./script.js";

const apps: Awaited<ReturnType<typeof createApp>>[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(apps.splice(0).map(app => app.fiber.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

export async function createScenario() {
  const root = await mkdtemp(join(tmpdir(), "navo-f98-"));
  roots.push(root);
  await writeFile(join(root, "evidence.txt"), "EVIDENCE_BODY: observation supports the candidate.");
  await writeFile(join(root, "validation.txt"), "VALIDATION_BODY: independent check confirms the observation.");
  const app = await createApp({ node: { session: { model: { provider: "mock", model: "longterm" } } } });
  apps.push(app);
  const project = app.projects.create({ goal: "Deliver an evidence-backed recommendation" });
  await app.projectWorkspaces.create(project.id, root);
  const script = scenario();
  const adapter = new MockLLMAdapter(script.entries);
  app.llm.registerAdapter("mock", adapter);
  const nodeId = (key: string) => {
    const value = script.ids.get(key);
    if (!value) throw new Error(`Missing Node receipt: ${key}`);
    return createNodeId(value);
  };
  return { app, project, adapter, nodeId };
}

export function confirm(app: Awaited<ReturnType<typeof createApp>>, projectId: ProjectId, nodeId: NodeId) {
  return app.projectRuntime.confirmCompletion(projectId, nodeId, {
    confirmedBy: "human", reason: "Reviewed result", reviewedRevision: app.nodes.get(nodeId)!.revision,
  });
}
