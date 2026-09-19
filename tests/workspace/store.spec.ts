import { mkdir, mkdtemp, rm, stat, symlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import { createProjectId } from "../../src/brand/ids.js";
import { ProjectStore } from "../../src/project/store.js";
import { ProjectWorkspaceStore } from "../../src/workspace/store.js";

const contexts: Context[] = [];
const roots: string[] = [];

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()));
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })));
});

async function fixture(prefix = "navo-workspace-"): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

async function domain(root: string): Promise<Context> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(ProjectStore);
  await ctx.plugin(ProjectWorkspaceStore, { root });
  return ctx;
}

describe("Project Workspace foundation", () => {
  it("creates isolated idempotent roots with reserved assets and nodes directories", async () => {
    const root = await fixture();
    const ctx = await domain(root);
    const first = ctx.projects.create({ goal: "First project" });
    const second = ctx.projects.create({ goal: "Second project" });

    const firstWorkspace = await ctx.projectWorkspaces.create(first.id);
    const repeated = await ctx.projectWorkspaces.create(first.id);
    const secondWorkspace = await ctx.projectWorkspaces.create(second.id);

    expect(repeated).toEqual(firstWorkspace);
    expect(firstWorkspace.root).not.toBe(secondWorkspace.root);
    expect(firstWorkspace.root.startsWith(join(root, "projects"))).toBe(true);
    expect((await stat(firstWorkspace.assetsRoot)).isDirectory()).toBe(true);
    expect((await stat(firstWorkspace.nodesRoot)).isDirectory()).toBe(true);
    expect(await ctx.projectWorkspaces.get(first.id)).toEqual(firstWorkspace);
  });

  it("resolves only portable Project-relative refs and preserves the ref as identity", async () => {
    const root = await fixture();
    const ctx = await domain(root);
    const project = ctx.projects.create({ goal: "Resolve resources" });
    const workspace = await ctx.projectWorkspaces.create(project.id);
    await writeFile(join(workspace.assetsRoot, "report.md"), "report\n", "utf8");

    const existing = await ctx.projectWorkspaces.resolve(project.id, "assets/report.md");
    const missing = await ctx.projectWorkspaces.resolve(project.id, "assets/new.md");

    expect(existing).toMatchObject({
      projectId: project.id,
      ref: "assets/report.md",
      exists: true,
    });
    expect(existing.path).toBe(join(workspace.assetsRoot, "report.md"));
    expect(missing).toMatchObject({
      ref: "assets/new.md",
      path: join(workspace.assetsRoot, "new.md"),
      exists: false,
    });

    for (const ref of [
      "../outside.txt",
      "assets/../nodes/private.txt",
      "/absolute.txt",
      "C:/absolute.txt",
      "assets\\outside.txt",
      "assets//report.md",
    ]) {
      await expect(ctx.projectWorkspaces.resolve(project.id, ref))
        .rejects.toMatchObject({ code: "invalid-ref" });
    }
  });

  it("rejects symlink escape even when the ref itself contains no parent segment", async () => {
    const root = await fixture();
    const outside = await fixture("navo-workspace-outside-");
    const ctx = await domain(root);
    const project = ctx.projects.create({ goal: "Contain filesystem access" });
    const workspace = await ctx.projectWorkspaces.create(project.id);
    await writeFile(join(outside, "secret.txt"), "secret\n", "utf8");

    await symlink(
      outside,
      join(workspace.assetsRoot, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(ctx.projectWorkspaces.resolve(project.id, "assets/escape/secret.txt"))
      .rejects.toMatchObject({ code: "path-not-allowed" });
  });

  it("cleans one Project without touching another Project Workspace", async () => {
    const root = await fixture();
    const ctx = await domain(root);
    const first = ctx.projects.create({ goal: "Disposable project" });
    const second = ctx.projects.create({ goal: "Persistent project" });
    const firstWorkspace = await ctx.projectWorkspaces.create(first.id);
    const secondWorkspace = await ctx.projectWorkspaces.create(second.id);
    await writeFile(join(firstWorkspace.assetsRoot, "first.md"), "first", "utf8");
    await writeFile(join(secondWorkspace.assetsRoot, "second.md"), "second", "utf8");

    expect(await ctx.projectWorkspaces.cleanup(first.id)).toBe(true);
    expect(await ctx.projectWorkspaces.get(first.id)).toBeUndefined();
    expect(await ctx.projectWorkspaces.cleanup(first.id)).toBe(false);
    expect(await ctx.projectWorkspaces.resolve(second.id, "assets/second.md"))
      .toMatchObject({ exists: true });
  });

  it("requires Project ownership and mounts in NavoApp only with an explicit root", async () => {
    const root = await fixture();
    const ctx = await domain(root);
    await expect(ctx.projectWorkspaces.create(createProjectId("missing")))
      .rejects.toMatchObject({ code: "project-not-found" });

    const appRoot = await fixture("navo-workspace-app-");
    const app = await createApp({
      node: { session: { model: { provider: "mock", model: "test" } } },
      workspace: { root: appRoot },
    });
    contexts.push(app);
    const project = app.projects.create({ goal: "Mounted Workspace" });
    const workspace = await app.projectWorkspaces.create(project.id);
    expect(workspace.projectId).toBe(project.id);
    expect((await stat(workspace.root)).isDirectory()).toBe(true);
  });

  it("rejects a missing configured base root instead of silently creating it", async () => {
    const parent = await fixture();
    const missingRoot = join(parent, "missing");
    const ctx = await domain(missingRoot);
    const project = ctx.projects.create({ goal: "Invalid root" });

    await expect(ctx.projectWorkspaces.create(project.id))
      .rejects.toMatchObject({ code: "not-found" });

    await mkdir(missingRoot);
    const workspace = await ctx.projectWorkspaces.create(project.id);
    expect((await stat(workspace.root)).isDirectory()).toBe(true);
  });
});
