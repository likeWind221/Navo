import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SessionId, ToolCallId } from "../../../src/brand/ids.js";
import { createEditTool, editTextFile } from "../../../src/tools/builtins/file/edit.js";
import { FILE_LIMITS, type EditRequest } from "../../../src/tools/builtins/file/types.js";

let root: string;
const signal = new AbortController().signal;

beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), "skillworld-edit-"))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function edit(content: string | Uint8Array, request: Partial<EditRequest>) {
  await writeFile(join(root, "text.txt"), content);
  return editTextFile({ cwd: root }, {
    path: "text.txt",
    oldText: "before",
    newText: "after",
    ...request,
  }, signal);
}

describe("edit text files", () => {
  it("replaces one exact literal match without normalizing line endings", async () => {
    const result = await edit("head\r\nbefore\r\ntail\n", {
      oldText: "before\r\n",
      newText: "中文\r\n",
    });

    expect(await readFile(join(root, "text.txt"), "utf8")).toBe("head\r\n中文\r\ntail\n");
    expect(result).toEqual({
      path: resolve(root, "text.txt"),
      operation: "edit",
      bytesWritten: Buffer.byteLength("head\r\n中文\r\ntail\n", "utf8"),
    });
  });

  it("allows deletion and preserves the existing file mode", async () => {
    const path = join(root, "text.txt");
    await writeFile(path, "left--remove--right", "utf8");
    if (process.platform !== "win32") await chmod(path, 0o640);

    await editTextFile({ cwd: root }, {
      path: "text.txt",
      oldText: "--remove--",
      newText: "",
    }, signal);

    expect(await readFile(path, "utf8")).toBe("leftright");
    if (process.platform !== "win32") expect((await lstat(path)).mode & 0o777).toBe(0o640);
  });

  it("rejects absent, repeated and overlapping matches without changing the file", async () => {
    await writeFile(join(root, "text.txt"), "aaa", "utf8");

    await expect(editTextFile({ cwd: root }, {
      path: "text.txt", oldText: "missing", newText: "x",
    }, signal)).rejects.toMatchObject({ code: "edit-not-found" });
    expect(await readFile(join(root, "text.txt"), "utf8")).toBe("aaa");

    await expect(editTextFile({ cwd: root }, {
      path: "text.txt", oldText: "a", newText: "x",
    }, signal)).rejects.toMatchObject({ code: "edit-not-unique" });
    expect(await readFile(join(root, "text.txt"), "utf8")).toBe("aaa");

    await expect(editTextFile({ cwd: root }, {
      path: "text.txt", oldText: "aa", newText: "x",
    }, signal)).rejects.toMatchObject({ code: "edit-not-unique" });
    expect(await readFile(join(root, "text.txt"), "utf8")).toBe("aaa");
  });

  it("rejects missing targets, directories and invalid request text", async () => {
    await mkdir(join(root, "dir"));
    await expect(editTextFile({ cwd: root }, {
      path: "missing.txt", oldText: "a", newText: "b",
    }, signal)).rejects.toMatchObject({ code: "not-found" });
    await expect(editTextFile({ cwd: root }, {
      path: "dir", oldText: "a", newText: "b",
    }, signal)).rejects.toMatchObject({ code: "not-a-file" });
    await expect(edit("before", { oldText: "", newText: "x" }))
      .rejects.toMatchObject({ code: "invalid-request" });
    await expect(edit("before", { oldText: "before", newText: "before" }))
      .rejects.toMatchObject({ code: "invalid-request" });
    await expect(edit("before", { oldText: "before", newText: "x\0y" }))
      .rejects.toMatchObject({ code: "invalid-text" });
    await expect(edit("before", { oldText: "before", newText: "\uD800" }))
      .rejects.toMatchObject({ code: "invalid-text" });
    await expect(edit("before", { oldText: "x".repeat(FILE_LIMITS.maxFileBytes + 1) }))
      .rejects.toMatchObject({ code: "file-too-large" });
  });

  it("rejects invalid UTF-8, NUL files and source or result content over 5 MiB", async () => {
    await expect(edit(Buffer.from([0xff]), { oldText: "a", newText: "b" }))
      .rejects.toMatchObject({ code: "invalid-text" });
    await expect(edit(Buffer.from("before\0tail"), { oldText: "before", newText: "after" }))
      .rejects.toMatchObject({ code: "invalid-text" });
    await expect(edit("before" + "x".repeat(FILE_LIMITS.maxFileBytes), {}))
      .rejects.toMatchObject({ code: "file-too-large" });
    await expect(edit("before", { newText: "x".repeat(FILE_LIMITS.maxFileBytes + 1) }))
      .rejects.toMatchObject({ code: "file-too-large" });
    expect((await readdir(root)).some((name) => name.startsWith(".skillworld-edit-"))).toBe(false);
  });

  it("edits the canonical target through a symlink without replacing the link", async () => {
    if (process.platform === "win32") return;
    const target = join(root, "target.txt");
    const alias = join(root, "alias.txt");
    await writeFile(target, "before", "utf8");
    await symlink(target, alias, "file");

    const result = await editTextFile({ cwd: root }, {
      path: "alias.txt", oldText: "before", newText: "after",
    }, signal);

    expect(result.path).toBe(await realpath(target));
    expect(await readFile(target, "utf8")).toBe("after");
    expect((await lstat(alias)).isSymbolicLink()).toBe(true);
  });

  it("reports cancellation before IO and leaves no staging file", async () => {
    await writeFile(join(root, "text.txt"), "before", "utf8");
    const controller = new AbortController();
    controller.abort();

    await expect(editTextFile({ cwd: root }, {
      path: "text.txt", oldText: "before", newText: "after",
    }, controller.signal)).rejects.toMatchObject({ code: "aborted" });
    expect(await readFile(join(root, "text.txt"), "utf8")).toBe("before");
    expect((await readdir(root)).some((name) => name.startsWith(".skillworld-edit-"))).toBe(false);
  });

  it("formats tool success and converts failures to stable model messages", async () => {
    await writeFile(join(root, "text.txt"), "before", "utf8");
    const tool = createEditTool({ resolveFileEnvironment: () => ({ cwd: root }) });
    const result = await tool.execute({ path: "text.txt", oldText: "before", newText: "after" }, {
      callId: "edit-call" as ToolCallId,
      sessionId: "session" as SessionId,
      signal,
    });

    expect(result.content).toBe(`Edited ${JSON.stringify(resolve(root, "text.txt"))} (5 bytes).`);
    await expect(tool.execute({ path: "text.txt", oldText: "after", newText: "x" }, {
      callId: "edit-no-session" as ToolCallId,
      signal,
    })).rejects.toMatchObject({ modelMessage: "File tools require an active Session." });
  });
});
