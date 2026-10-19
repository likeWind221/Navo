import { mkdir, open, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, it } from "vitest";
import { ASSET_LIMITS } from "../../../src/resource/assets.js";
import { libraryPathKey, normalizeLibraryPath, numberedLibraryPath } from "../../../src/resource/library.js";
import { fixture } from "./helpers.js";

it.each(["", "/a", "C:/a", "C:a", "//server/share", "a\\b", "a\0b", "a//b", "a/./b", "a/../b", "../a", "CON", "nul.txt", "a/COM1.md", "LPT9", "com¹.txt", "file.", "file ", "a:b", "a?b", "a*b", "a|b", "a\nb"])("rejects unsafe logical path %j", value => {
  expect(() => normalizeLibraryPath(value)).toThrow();
});

it("normalizes NFC and compares case independently of the host, numbering before the extension", () => {
  expect(normalizeLibraryPath("folder/e\u0301.MD")).toBe("folder/é.MD");
  expect(libraryPathKey("FOLDER/É.md")).toBe(libraryPathKey("folder/e\u0301.MD"));
  expect(numberedLibraryPath("report.md", new Set(["report.md", "report (1).md"]))).toBe("report (2).md");
});

it("allocates different normalized paths to concurrent Agent publications without changing display names", async () => {
  const { ctx, input } = await fixture();
  const resources = await Promise.all(Array.from({ length: 4 }, () => ctx.resources.publish(input)));
  expect(new Set(resources.map(resource => resource.libraryPath))).toEqual(new Set(["report.md", "report (1).md", "report (2).md", "report (3).md"]));
  expect(new Set(resources.map(resource => resource.name))).toEqual(new Set(["Report"]));
});

it("resolves actual NFC and case-normalized publication conflicts at commit", async () => {
  const { ctx, root, input } = await fixture();
  await mkdir(join(root, "one"));
  await mkdir(join(root, "two"));
  await writeFile(join(root, "one", "e\u0301.md"), "one");
  await writeFile(join(root, "two", "É.MD"), "two");
  const resources = await Promise.all(["one/e\u0301.md", "two/É.MD"].map(sourceRef => ctx.resources.publish({ ...input, sourceRef })));
  expect(new Set(resources.map(resource => libraryPathKey(resource.libraryPath))).size).toBe(2);
  expect(resources.every(resource => resource.libraryPath === resource.libraryPath.normalize("NFC"))).toBe(true);
  expect(resources.some(resource => resource.libraryPath.includes(" (1)."))).toBe(true);
});

it("does not follow a Workspace source symlink outside the authorized root", async () => {
  const { ctx, root, input } = await fixture();
  const outside = join(dirname(root), "outside");
  await mkdir(outside);
  await writeFile(join(outside, "secret.md"), "secret");
  await symlink(outside, join(root, "escape"), process.platform === "win32" ? "junction" : "dir");
  await expect(ctx.resources.publish({ ...input, sourceRef: "escape/secret.md" })).rejects.toMatchObject({ code: "resource-content-unavailable" });
  expect(ctx.resources.listByProject(input.projectId)).toEqual([]);
});

it("enforces the single-file limit before copying and does not emit a Resource", async () => {
  const { ctx, root, input } = await fixture();
  const file = await open(join(root, "large.md"), "w");
  try { await file.truncate(ASSET_LIMITS.maxFileBytes + 1); } finally { await file.close(); }
  await expect(ctx.resources.publish({ ...input, sourceRef: "large.md" })).rejects.toMatchObject({ code: "invalid-resource" });
  expect(ctx.resources.listByProject(input.projectId)).toEqual([]);
});

it("accepts the configured byte boundary exactly and rejects the next byte", async () => {
  const { ctx, root, input } = await fixture({ maxFileBytes: 4 });
  await writeFile(join(root, input.sourceRef), "1234");
  expect((await ctx.resources.publish(input)).assetGeneration).toBe(1);
  await writeFile(join(root, input.sourceRef), "12345");
  await expect(ctx.resources.publish(input)).rejects.toMatchObject({ code: "invalid-resource" });
  expect(ctx.resources.listByProject(input.projectId)).toHaveLength(1);
});
