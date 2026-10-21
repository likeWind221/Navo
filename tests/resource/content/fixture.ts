import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Context } from "cordis";
import { afterEach } from "vitest";
import { StorageService } from "../../../src/storage/database.js";
import { ProjectStore } from "../../../src/project/store.js";
import { NodeStore } from "../../../src/node/store.js";
import { ProjectWorkspaceStore } from "../../../src/workspace/store.js";
import { ResourceRecovery, ResourceService } from "../../../src/resource/service.js";
import { ContentProcessor, type ContentProcessorConfig } from "../../../src/resource/content.js";

const contexts: Context[] = [];
const roots: string[] = [];
afterEach(async () => {
  for (const ctx of contexts.splice(0)) await ctx.fiber.dispose();
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

export async function openContent(path: string, config: ContentProcessorConfig = {}) {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(StorageService, { path });
  await ctx.plugin(ProjectStore);
  await ctx.plugin(NodeStore);
  await ctx.plugin(ProjectWorkspaceStore);
  await ctx.plugin(ResourceService);
  await ctx.plugin(ResourceRecovery);
  await ctx.plugin(ContentProcessor, config);
  return ctx;
}

export async function fixture(config: ContentProcessorConfig = {}) {
  const base = await mkdtemp(join(tmpdir(), "navo-content-"));
  roots.push(base);
  const path = join(base, "navo.db");
  const root = join(base, "workspace");
  await mkdir(root);
  const ctx = await openContent(path, config);
  const project = ctx.projects.create({ name: "Content", goal: null });
  const workspace = await ctx.projectWorkspaces.create(project.id, root);
  const input = { projectId: project.id, owner: { kind: "main" as const }, sourceRef: "source.md",
    name: "Report", description: "Report", type: "text/markdown" };
  await writeFile(join(root, "source.md"), "# Original\n");
  const resource = await ctx.resources.publish(input);
  return { ctx, project, root, path, workspace, resource, input };
}

export const ready = (body = "body") => ({ status: "ready" as const, body, pageMap: [], extractorVersion: "test-v1" });
