import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createApp } from "../../src/app.js";
import {
  createProjectId,
  createSessionId,
  createToolCallId,
} from "../../src/brand/ids.js";
import { ProjectStore } from "../../src/project/store.js";
import { createFileEnvironment } from "../../src/tools/builtins/file/path.js";
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

async function domain(): Promise<Context> {
  const ctx = new Context();
  contexts.push(ctx);
  await ctx.plugin(ProjectStore);
  await ctx.plugin(ProjectWorkspaceStore);
  return ctx;
}

describe("Project Workspace root migration", () => {
  it("binds an existing user directory and keeps Navo infrastructure inside .navo", async () => {
    const root = await fixture();
    await mkdir(join(root, "src"));
    await writeFile(join(root, "README.txt"), "user content\n", "utf8");
    const ctx = await domain();
    const project = ctx.projects.create({ goal: "Use an existing repository" });

    const workspace = await ctx.projectWorkspaces.create(project.id, root);
    const repeated = await ctx.projectWorkspaces.create(project.id, root);
    const canonicalRoot = await realpath(root);

    expect(repeated).toEqual(workspace);
    expect(workspace).toMatchObject({
      projectId: project.id,
      root: canonicalRoot,
      navoRoot: join(canonicalRoot, ".navo"),
      assetsRoot: join(canonicalRoot, ".navo", "assets"),
      nodesRoot: join(canonicalRoot, ".navo", "nodes"),
      skillsRoot: join(canonicalRoot, ".navo", "skills"),
    });
    expect((await stat(workspace.assetsRoot)).isDirectory()).toBe(true);
    expect((await stat(workspace.nodesRoot)).isDirectory()).toBe(true);
    expect((await stat(workspace.skillsRoot)).isDirectory()).toBe(true);
    expect(await readFile(join(root, "README.txt"), "utf8")).toBe("user content\n");
    expect((await stat(join(root, "src"))).isDirectory()).toBe(true);
  });

  it("keeps one physical Workspace owned by one Project and rejects rebinding", async () => {
    const firstRoot = await fixture();
    const secondRoot = await fixture();
    const ctx = await domain();
    const first = ctx.projects.create({ goal: "First" });
    const second = ctx.projects.create({ goal: "Second" });

    await ctx.projectWorkspaces.create(first.id, firstRoot);

    await expect(ctx.projectWorkspaces.create(first.id, secondRoot))
      .rejects.toMatchObject({ code: "workspace-conflict" });
    await expect(ctx.projectWorkspaces.create(second.id, firstRoot))
      .rejects.toMatchObject({ code: "workspace-conflict" });

    const secondWorkspace = await ctx.projectWorkspaces.create(second.id, secondRoot);
    expect(secondWorkspace.root).toBe(await realpath(secondRoot));
  });

  it("resolves internal refs from .navo and preserves portable Resource refs", async () => {
    const root = await fixture();
    const ctx = await domain();
    const project = ctx.projects.create({ goal: "Resolve resources" });
    const workspace = await ctx.projectWorkspaces.create(project.id, root);
    await writeFile(join(workspace.assetsRoot, "report.md"), "report\n", "utf8");

    const existing = await ctx.projectWorkspaces.resolve(project.id, "assets/report.md");
    const missing = await ctx.projectWorkspaces.resolve(project.id, "assets/new.md");

    expect(existing).toMatchObject({
      projectId: project.id,
      ref: "assets/report.md",
      path: join(workspace.assetsRoot, "report.md"),
      exists: true,
    });
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

  it("rejects symlink escape from the Navo internal area", async () => {
    const root = await fixture();
    const outside = await fixture("navo-workspace-outside-");
    const ctx = await domain();
    const project = ctx.projects.create({ goal: "Contain internal files" });
    const workspace = await ctx.projectWorkspaces.create(project.id, root);
    await writeFile(join(outside, "secret.txt"), "secret\n", "utf8");

    await symlink(
      outside,
      join(workspace.assetsRoot, "escape"),
      process.platform === "win32" ? "junction" : "dir",
    );

    await expect(ctx.projectWorkspaces.resolve(project.id, "assets/escape/secret.txt"))
      .rejects.toMatchObject({ code: "path-not-allowed" });
  });

  it("cleanup removes only .navo and never deletes the user Workspace", async () => {
    const root = await fixture();
    const ctx = await domain();
    const project = ctx.projects.create({ goal: "Cleanup Navo state" });
    const workspace = await ctx.projectWorkspaces.create(project.id, root);
    await writeFile(join(root, "user.txt"), "keep", "utf8");
    await writeFile(join(workspace.assetsRoot, "asset.txt"), "remove", "utf8");

    expect(await ctx.projectWorkspaces.cleanup(project.id)).toBe(true);
    expect(await readFile(join(root, "user.txt"), "utf8")).toBe("keep");
    await expect(stat(join(root, ".navo"))).rejects.toMatchObject({ code: "ENOENT" });
    expect(await ctx.projectWorkspaces.get(project.id)).toBeUndefined();
    expect(await ctx.projectWorkspaces.cleanup(project.id)).toBe(false);
  });

  it("requires an existing Project and existing directory root", async () => {
    const root = await fixture();
    const ctx = await domain();

    await expect(ctx.projectWorkspaces.create(createProjectId("missing"), root))
      .rejects.toMatchObject({ code: "project-not-found" });

    const project = ctx.projects.create({ goal: "Validate root" });
    await expect(ctx.projectWorkspaces.create(project.id, join(root, "missing")))
      .rejects.toMatchObject({ code: "not-found" });

    const file = join(root, "file.txt");
    await writeFile(file, "x", "utf8");
    await expect(ctx.projectWorkspaces.create(project.id, file))
      .rejects.toMatchObject({ code: "not-a-directory" });
  });

  it("mounts Workspace and Resource services without a global Workspace root config", async () => {
    const root = await fixture();
    const app = await createApp({
      node: { session: { model: { provider: "mock", model: "test" } } },
    });
    contexts.push(app);
    const project = app.projects.create({ goal: "Mounted Workspace" });
    const workspace = await app.projectWorkspaces.create(project.id, root);

    expect(workspace.root).toBe(await realpath(root));
    expect(app.resources).toBeDefined();
  });

  it("confines Project-bound file reads even when the Host file environment is broader", async () => {
    const hostRoot = await fixture();
    const projectRoot = join(hostRoot, "project");
    await mkdir(projectRoot);
    await writeFile(join(projectRoot, "inside.txt"), "inside\n", "utf8");
    await writeFile(join(hostRoot, "outside.txt"), "outside\n", "utf8");
    const hostEnvironment = await createFileEnvironment(hostRoot);

    const app = await createApp({
      node: { session: { model: { provider: "mock", model: "test" } } },
      tools: { file: { resolveFileEnvironment: () => hostEnvironment } },
    });
    contexts.push(app);
    const project = app.projects.create({ goal: "Bounded Node files" });
    await app.projectWorkspaces.create(project.id, projectRoot);
    const node = app.nodes.create({
      projectId: project.id,
      objective: {
        title: "Read project",
        description: "Read only this project",
        acceptanceCriteria: ["Stay inside workspace"],
      },
    });
    app.nodes.unlock(node.node.id, "test");
    const sessionId = createSessionId("workspace-bounded-node");
    app.nodes.bindSession(node.node.id, sessionId);

    const inside = await app.tools.execute({
      type: "tool-call",
      id: createToolCallId("read-inside"),
      name: "read",
      arguments: JSON.stringify({ path: "inside.txt" }),
    }, new AbortController().signal, {
      sessionId,
      allowedTools: ["read"],
    });
    expect(inside).toMatchObject({ kind: "success" });
    expect(inside.block.content).toEqual([
      expect.objectContaining({ type: "text", text: expect.stringContaining("inside") }),
    ]);

    const outside = await app.tools.execute({
      type: "tool-call",
      id: createToolCallId("read-outside"),
      name: "read",
      arguments: JSON.stringify({ path: "../outside.txt" }),
    }, new AbortController().signal, {
      sessionId,
      allowedTools: ["read"],
    });
    expect(outside).toMatchObject({
      kind: "failure",
      failure: {
        code: "tool-failed",
        modelMessage: "The requested path is not available in the current file environment.",
      },
    });
  });
});
