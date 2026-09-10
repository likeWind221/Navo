import { mkdtemp, mkdir, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

import { describe, expect, it } from "vitest";

import { FileError } from "../../../src/tools/builtins/file/errors.js";
import {
  createFileExecutionWorld,
  resolveFileTarget,
} from "../../../src/tools/builtins/file/path.js";

describe("file execution world path targets", () => {
  it("uses the fixed cwd and normalizes dot segments", async () => {
    const root = await createFixture();
    try {
      const world = await createFileExecutionWorld(root);
      const relative = await resolveFileTarget(world, "notes/./nested/../a.txt");
      const absolute = await resolveFileTarget(world, join(root, "notes", "a.txt"));

      expect(relative.path).toBe(absolute.path);
      expect(relative.exists).toBe(true);
      expect(relative.inputPath).toBe("notes/./nested/../a.txt");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("gives shared cwd worlds the same target and keeps other cwd paths distinct", async () => {
    const firstRoot = await createFixture();
    const secondRoot = await createFixture();
    try {
      const first = await createFileExecutionWorld(firstRoot);
      const shared = await createFileExecutionWorld(firstRoot);
      const second = await createFileExecutionWorld(secondRoot);

      const firstTarget = await resolveFileTarget(first, "notes/a.txt");
      const sharedTarget = await resolveFileTarget(shared, "notes/a.txt");
      const secondTarget = await resolveFileTarget(second, "notes/a.txt");

      expect(firstTarget.path).toBe(sharedTarget.path);
      expect(firstTarget.path).not.toBe(secondTarget.path);
    } finally {
      await Promise.all([
        rm(firstRoot, { recursive: true, force: true }),
        rm(secondRoot, { recursive: true, force: true }),
      ]);
    }
  });

  it("canonicalizes directory symlinks and preserves a missing leaf target", async () => {
    const root = await createFixture();
    try {
      const alias = join(root, "alias");
      await symlink(join(root, "notes"), alias, process.platform === "win32" ? "junction" : "dir");
      const world = await createFileExecutionWorld(root);
      const throughAlias = await resolveFileTarget(world, "alias/a.txt");
      const direct = await resolveFileTarget(world, "notes/a.txt");
      const missing = await resolveFileTarget(world, "alias/new.txt");

      expect(throughAlias.path).toBe(direct.path);
      expect(missing.exists).toBe(false);
      expect(missing.path).toBe(join(dirname(direct.path), "new.txt"));
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("requires an absolute existing directory and rejects invalid paths", async () => {
    await expect(createFileExecutionWorld("relative/workspace"))
      .rejects.toMatchObject({ code: "invalid-config" });

    const root = await createFixture();
    try {
      const world = await createFileExecutionWorld(root);
      await expect(resolveFileTarget(world, ""))
        .rejects.toMatchObject({ code: "invalid-path" });
      await expect(resolveFileTarget(world, "missing/child.txt"))
        .rejects.toMatchObject({ code: "not-found" });
      await expect(createFileExecutionWorld(join(root, "notes", "a.txt")))
        .rejects.toMatchObject({ code: "not-a-directory" });
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});

async function createFixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "skillworld-file-"));
  await mkdir(join(root, "notes"));
  await writeFile(join(root, "notes", "a.txt"), "content\n", "utf8");
  return resolve(root);
}
