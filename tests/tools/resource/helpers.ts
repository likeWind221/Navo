import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { Context } from "cordis";

import { createApp } from "../../../src/app.js";
import {
  createSessionId,
  createToolCallId,
} from "../../../src/brand/ids.js";
import type {
  ProjectId,
  SessionId,
} from "../../../src/brand/ids.js";
import { createFileEnvironment } from "../../../src/tools/builtins/file/path.js";

const apps: Context[] = [];
const roots: string[] = [];
let callSequence = 0;

export async function cleanupResourceToolFixtures(): Promise<void> {
  await Promise.all(apps.splice(0).map(app => app.fiber.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
  callSequence = 0;
}

export async function resourceToolFixture() {
  const root = await mkdtemp(join(tmpdir(), "navo-resource-tools-"));
  roots.push(root);
  const hostEnvironment = await createFileEnvironment(root);
  const app = await createApp({
    node: { session: { model: { provider: "mock", model: "test" } } },
    tools: {
      file: {
        resolveFileEnvironment: () => hostEnvironment,
      },
    },
  });
  apps.push(app);
  const project = app.projects.create({ goal: "Resource capabilities" });
  const workspace = await app.projectWorkspaces.create(project.id, root);
  return { app, project, workspace, root };
}

export function bindResourceNode(app: Context, projectId: ProjectId) {
  const node = app.nodes.create({
    projectId,
    objective: {
      title: "Produce findings",
      description: "Produce reusable findings",
      acceptanceCriteria: ["Publish the result"],
    },
  });
  app.nodes.unlock(node.node.id, "test");
  const sessionId = createSessionId(`resource-node-${callSequence++}`);
  app.nodes.bindSession(node.node.id, sessionId);
  return { node, sessionId };
}

export async function callResourceTool(
  app: Context,
  sessionId: SessionId,
  name: string,
  arguments_: Record<string, unknown>,
) {
  return app.tools.execute({
    type: "tool-call",
    id: createToolCallId(`resource-call-${callSequence++}`),
    name,
    arguments: JSON.stringify(arguments_),
  }, new AbortController().signal, {
    sessionId,
    allowedTools: [name],
  });
}

export function resourceResultText(
  result: Awaited<ReturnType<typeof callResourceTool>>,
): string {
  const block = result.block.content[0];
  if (block?.type !== "text") throw new Error("Expected text tool result.");
  return block.text;
}

export function resourceArtifact(
  result: Awaited<ReturnType<typeof callResourceTool>>,
): Record<string, unknown> {
  if (
    result.kind !== "success"
    || result.artifact === undefined
    || result.artifact === null
    || typeof result.artifact !== "object"
    || Array.isArray(result.artifact)
  ) {
    throw new Error("Expected successful tool result with object artifact.");
  }
  return result.artifact as Record<string, unknown>;
}
