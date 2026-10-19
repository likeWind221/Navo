import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { Context } from "cordis";
import { afterEach } from "vitest";
import { createApp } from "../../../src/app.js";
import type { FileOperation } from "../../../src/storage/operations.js";
import type { ResourceConfig } from "../../../src/resource/service.js";
import { removeRoots, temporaryDatabase } from "../../helpers/storage.js";

const roots: string[] = [];
const contexts: Context[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
  await removeRoots(roots);
});

export async function open(path: string, resources?: ResourceConfig) {
  const ctx = await createApp({ storage: { path }, ...(resources === undefined ? {} : { resources }), node: { session: { model: { provider: "mock", model: "test" } } } });
  contexts.push(ctx);
  return ctx;
}

export async function fixture(resources?: ResourceConfig) {
  const path = await temporaryDatabase(roots, "navo-asset-kernel-");
  const ctx = await open(path, resources);
  const project = ctx.projects.create({ name: "Assets", goal: null });
  const root = join(dirname(path), "workspace");
  await mkdir(root);
  const workspace = await ctx.projectWorkspaces.create(project.id, root);
  await writeFile(join(root, "report.md"), "generation one");
  const input = { projectId: project.id, owner: { kind: "main" as const }, sourceRef: "report.md", name: "Report", description: "Report", type: "text/markdown" };
  return { ctx, path, root, project, workspace, input };
}

export function operation(ctx: Context, operationId: string): FileOperation {
  return ctx.storage.atomic(tx => tx.getFileOperation(operationId))!;
}

export function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}
