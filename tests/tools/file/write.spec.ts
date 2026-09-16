import { chmod, lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import type { SessionId, ToolCallId } from "../../../src/brand/ids.js";
import { FileObservationStore } from "../../../src/tools/builtins/file/observation.js";
import { createReadTool } from "../../../src/tools/builtins/file/read.js";
import { FILE_LIMITS } from "../../../src/tools/builtins/file/types.js";
import { createWriteTool, writeTextFile } from "../../../src/tools/builtins/file/write.js";

let root: string;
const signal = new AbortController().signal;
const sessionA = "session-a" as SessionId;
const sessionB = "session-b" as SessionId;

beforeEach(async () => { root = await realpath(await mkdtemp(join(tmpdir(), "skillworld-write-"))); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

function tools(observations = new FileObservationStore()) {
  const resolveFileEnvironment = () => ({ cwd: root });
  return {
    observations,
    read: createReadTool({
      resolveFileEnvironment,
      observations,
      saveResult: () => undefined,
    }),
    write: createWriteTool({ resolveFileEnvironment, observations }),
  };
}

function execution(sessionId: SessionId, callId: string) {
  return { callId: callId as ToolCallId, sessionId, signal };
}

describe("write text files", () => {
  it("creates a new file and records the resulting file as observed", async () => {
    const { write } = tools();
    const result = await write.execute(
      { path: "new.txt", content: "hello\n中文" },
      execution(sessionA, "write-create"),
    );

    expect(await readFile(join(root, "new.txt"), "utf8")).toBe("hello\n中文");
    expect(result.content).toBe(
      `Created ${JSON.stringify(resolve(root, "new.txt"))} (${Buffer.byteLength("hello\n中文")} bytes).`,
    );

    const second = await write.execute(
      { path: "new.txt", content: "second" },
      execution(sessionA, "write-again"),
    );
    expect(second.content).toContain("Overwrote");
    expect(await readFile(join(root, "new.txt"), "utf8")).toBe("second");
  });

  it("rejects blind overwrite until the same Session reads the canonical target", async () => {
    await writeFile(join(root, "existing.txt"), "old", "utf8");
    const { read, write } = tools();

    await expect(write.execute(
      { path: "existing.txt", content: "blind" },
      execution(sessionA, "blind-write"),
    )).rejects.toMatchObject({
      modelMessage: "Read the existing file in this Session before replacing it.",
    });
    expect(await readFile(join(root, "existing.txt"), "utf8")).toBe("old");

    await read.execute({ path: "existing.txt" }, execution(sessionA, "read-first"));
    const result = await write.execute(
      { path: "existing.txt", content: "new" },
      execution(sessionA, "observed-write"),
    );
    expect(result.content).toBe(`Overwrote ${JSON.stringify(resolve(root, "existing.txt"))} (3 bytes).`);
    expect(await readFile(join(root, "existing.txt"), "utf8")).toBe("new");
  });

  it("requires complete paginated observation before full replacement", async () => {
    const content = Array.from({ length: 250 }, (_, index) => `line-${index + 1}`).join("\n");
    await writeFile(join(root, "long.txt"), content, "utf8");
    const { read, write } = tools();

    const first = await read.execute(
      { path: "long.txt", maxLines: 200 },
      execution(sessionA, "read-page-1"),
    );
    expect(first.content).toContain("startLine=201");
    await expect(write.execute(
      { path: "long.txt", content: "replacement" },
      execution(sessionA, "write-too-early"),
    )).rejects.toMatchObject({
      modelMessage: "Read the existing file in this Session before replacing it.",
    });

    await read.execute(
      { path: "long.txt", startLine: 201, maxLines: 200 },
      execution(sessionA, "read-page-2"),
    );
    await expect(write.execute(
      { path: "long.txt", content: "replacement" },
      execution(sessionA, "write-after-full-read"),
    )).resolves.toMatchObject({ content: expect.stringContaining("Overwrote") });
  });

  it("keeps observations isolated between Sessions", async () => {
    await writeFile(join(root, "existing.txt"), "old", "utf8");
    const { read, write } = tools();
    await read.execute({ path: "existing.txt" }, execution(sessionA, "read-a"));

    await expect(write.execute(
      { path: "existing.txt", content: "from-b" },
      execution(sessionB, "write-b"),
    )).rejects.toMatchObject({ modelMessage: "Read the existing file in this Session before replacing it." });
    expect(await readFile(join(root, "existing.txt"), "utf8")).toBe("old");
  });

  it("allows empty content and preserves the mode of an observed existing file", async () => {
    const path = join(root, "existing.txt");
    await writeFile(path, "old", "utf8");
    if (process.platform !== "win32") await chmod(path, 0o640);
    const { read, write } = tools();
    await read.execute({ path: "existing.txt" }, execution(sessionA, "read-mode"));
    await write.execute({ path: "existing.txt", content: "" }, execution(sessionA, "write-empty"));

    expect(await readFile(path, "utf8")).toBe("");
    if (process.platform !== "win32") expect((await lstat(path)).mode & 0o777).toBe(0o640);
  });

  it("rejects directories, invalid text and oversized content without staging leftovers", async () => {
    await mkdir(join(root, "dir"));
    const observations = new FileObservationStore();
    observations.observeWhole(sessionA, resolve(root, "dir"));

    await expect(writeTextFile(
      { cwd: root }, { path: "dir", content: "x" }, sessionA, observations, signal,
    )).rejects.toMatchObject({ code: "not-a-file" });
    await expect(writeTextFile(
      { cwd: root }, { path: "nul.txt", content: "x\0y" }, sessionA, observations, signal,
    )).rejects.toMatchObject({ code: "invalid-text" });
    await expect(writeTextFile(
      { cwd: root }, { path: "bad.txt", content: "\uD800" }, sessionA, observations, signal,
    )).rejects.toMatchObject({ code: "invalid-text" });
    await expect(writeTextFile(
      { cwd: root },
      { path: "large.txt", content: "x".repeat(FILE_LIMITS.maxFileBytes + 1) },
      sessionA,
      observations,
      signal,
    )).rejects.toMatchObject({ code: "file-too-large" });
    expect((await readdir(root)).some((name) => name.startsWith(".skillworld-write-"))).toBe(false);
  });

  it("uses the same canonical observation through a file symlink", async () => {
    if (process.platform === "win32") return;
    const target = join(root, "target.txt");
    const alias = join(root, "alias.txt");
    await writeFile(target, "old", "utf8");
    await symlink(target, alias, "file");
    const { read, write } = tools();

    await read.execute({ path: "alias.txt" }, execution(sessionA, "read-alias"));
    const result = await write.execute(
      { path: "alias.txt", content: "new" },
      execution(sessionA, "write-alias"),
    );

    expect(result.content).toContain(JSON.stringify(await realpath(target)));
    expect(await readFile(target, "utf8")).toBe("new");
    expect((await lstat(alias)).isSymbolicLink()).toBe(true);
  });

  it("honors pre-cancellation and leaves no partial target or staging file", async () => {
    const controller = new AbortController();
    controller.abort();
    const observations = new FileObservationStore();

    await expect(writeTextFile(
      { cwd: root },
      { path: "cancelled.txt", content: "x".repeat(128 * 1024) },
      sessionA,
      observations,
      controller.signal,
    )).rejects.toMatchObject({ code: "aborted" });
    await expect(readFile(join(root, "cancelled.txt"), "utf8")).rejects.toMatchObject({ code: "ENOENT" });
    expect((await readdir(root)).some((name) => name.startsWith(".skillworld-write-"))).toBe(false);
  });

  it("requires an active Session at the Tool boundary", async () => {
    const { write } = tools();
    await expect(write.execute({ path: "new.txt", content: "x" }, {
      callId: "write-no-session" as ToolCallId,
      signal,
    })).rejects.toMatchObject({ modelMessage: "File tools require an active Session." });
  });
});
