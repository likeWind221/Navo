import { mkdtemp, writeFile, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createReadTool, readTextFile } from "../../../src/tools/builtins/file/read.js";
import { buildReadWindow, formatReadResult } from "../../../src/tools/builtins/file/read/window.js";
import { FILE_LIMITS, type ReadRequest, type ReadResult } from "../../../src/tools/builtins/file/types.js";
import type { SessionId, ToolCallId } from "../../../src/brand/ids.js";

let root: string;
const signal = new AbortController().signal;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "skillworld-read-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });

async function read(content: string | Uint8Array, request: Partial<ReadRequest> = {}) {
  await writeFile(join(root, "text.txt"), content);
  return readTextFile({ cwd: root }, { path: "text.txt", ...request }, signal);
}

describe("read text files", () => {
  it("reads BOM, CRLF, empty lines and a final bare CR without a phantom line", async () => {
    const result = await read("\uFEFF中文\r\n\nlast\r");
    expect(result.lines).toEqual([
      { line: 1, text: "中文" }, { line: 2, text: "" }, { line: 3, text: "last\r" },
    ]);
    expect(result.totalLines).toBe(3);
    expect(result.nextLine).toBeNull();
    expect((await read("a\n")).totalLines).toBe(1);
    expect((await read("")).lines).toEqual([]);
    expect((await read("\n")).lines).toEqual([{ line: 1, text: "" }]);
  });

  it("returns contiguous pages and rejects out-of-range windows", async () => {
    const first = await read("a\nb\nc", { maxLines: 2 });
    expect(first.nextLine).toBe(3);
    const last = await readTextFile({ cwd: root }, { path: "text.txt", startLine: first.nextLine! }, signal);
    expect(last.lines).toEqual([{ line: 3, text: "c" }]);
    expect(last.nextLine).toBeNull();
    await expect(read("a", { startLine: 2 })).rejects.toMatchObject({ code: "invalid-request" });
  });

  it.each([0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, null])("rejects invalid startLine %s", async (value) => {
    await expect(read("a", { startLine: value as number })).rejects.toMatchObject({ code: "invalid-request" });
  });

  it("rejects excessive line limits, missing files and directories", async () => {
    await expect(read("a", { maxLines: 1001 })).rejects.toMatchObject({ code: "invalid-request" });
    await expect(readTextFile({ cwd: root }, { path: "missing" }, signal)).rejects.toMatchObject({ code: "not-found" });
    await expect(readTextFile({ cwd: root }, { path: "." }, signal)).rejects.toMatchObject({ code: "not-a-file" });
  });

  it.each([Buffer.from([0xff]), Buffer.from([0xe4, 0xb8]), Buffer.from("a\0b")])("rejects invalid text", async (bytes) => {
    await expect(read(bytes)).rejects.toMatchObject({ code: "invalid-text" });
  });

  it("streams files over 5 MiB and skips oversized unselected lines", async () => {
    const result = await read("x".repeat(FILE_LIMITS.readStreamMinBytes) + "\n中文\nend\n", { startLine: 2, maxLines: 1 });
    expect(result.lines).toEqual([{ line: 2, text: "中文" }]);
    expect(result.totalLines).toBe(3);
    expect(result.nextLine).toBe(3);
  });

  it("preserves whole lines under the output budget", async () => {
    const result = await read("a\n" + "x".repeat(30_000));
    expect(result.lines).toEqual([{ line: 1, text: "a" }]);
    expect(result.nextLine).toBe(2);
    expect(formatReadResult(result).length).toBeLessThanOrEqual(FILE_LIMITS.maxOutputCharacters);
    await expect(read("x".repeat(30_000))).rejects.toMatchObject({ code: "output-too-large" });
  });

  it("validates bytes beyond the selected window", async () => {
    await expect(read(Buffer.concat([Buffer.from("a\n"), Buffer.from([0xff])]), { maxLines: 1 }))
      .rejects.toMatchObject({ code: "invalid-text" });
  });

  it("decodes multibyte sequences and CRLF across chunk boundaries", async () => {
    async function* chunks() {
      for (const byte of Buffer.from("\uFEFF中文\r\n\nend")) yield Buffer.from([byte]);
    }
    const result = await buildReadWindow(chunks(), "a", 1, 200, signal);
    expect(result.lines.map((line) => line.text)).toEqual(["中文", "", "end"]);
  });

  it("honors cancellation before IO and while consuming chunks", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(readTextFile({ cwd: root }, { path: "missing" }, controller.signal))
      .rejects.toMatchObject({ code: "aborted" });
    const active = new AbortController();
    let closed = false;
    async function* chunks() {
      try {
        yield Buffer.from("a\n");
        active.abort();
        yield Buffer.from("b");
      } finally { closed = true; }
    }
    await expect(buildReadWindow(chunks(), "a", 1, 1, active.signal)).rejects.toBeDefined();
    expect(closed).toBe(true);
  });

  it("saves canonical JSON and produces the same model text after replay", async () => {
    await writeFile(join(root, "text.txt"), "hello\nworld");
    const tool = createReadTool({
      resolveWorld: () => ({ cwd: root }),
      saveResult: async (result) => { await writeFile(join(root, "result.json"), JSON.stringify(result)); },
    });
    const result = await tool.execute({ path: "text.txt", maxLines: 1 }, {
      callId: "read-call" as ToolCallId, sessionId: "session" as SessionId, signal,
    });
    const saved = JSON.parse(await readFile(join(root, "result.json"), "utf8")) as ReadResult;
    expect(result.content).toBe(formatReadResult(saved));
    expect(result.content).toContain("1: hello");
    expect(result.content).toContain("startLine=2");
    expect(result.content).not.toContain('"lines":');
    await expect(tool.execute({ path: "text.txt" }, { callId: "x" as ToolCallId, signal }))
      .rejects.toMatchObject({ modelMessage: "File tools require an active Session." });
  });
});
