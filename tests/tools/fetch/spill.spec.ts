import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "cordis";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSessionId, createToolCallId } from "../../../src/brand/ids.js";
import { MockFetchCore } from "../../../src/tools/builtins/fetch/mock.js";
import { FetchTool } from "../../../src/tools/builtins/fetch/tool.js";
import { ToolService } from "../../../src/tools/service.js";

let root: string;
let ctx: Context | undefined;
const signal = new AbortController().signal;
const sessionId = createSessionId("fetch-spill-session");

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "skillworld-fetch-spill-")); });
afterEach(async () => {
  await ctx?.fiber.dispose();
  ctx = undefined;
  await rm(root, { recursive: true, force: true });
});

describe("web_fetch spill", () => {
  it("stores the complete result and returns a bounded preview plus file_path", async () => {
    const body = "source-line\n".repeat(600);
    ctx = new Context();
    await ctx.plugin(ToolService);
    await ctx.plugin(FetchTool, {
      core: new MockFetchCore([{ kind: "result", result: {
        url: "https://example.test/long",
        statusCode: 200,
        body: { kind: "text", format: "plain", content: body },
      } }]),
      maxOutputCharacters: 500,
      spill: { resolveFileEnvironment: () => ({ cwd: root }) },
    });

    const result = await ctx.tools.execute(call("long"), signal, { sessionId });
    expect(result.kind).toBe("success");
    const block = result.block.content[0];
    if (block?.type !== "text") throw new Error("Expected text output.");
    expect(block.text.length).toBeLessThanOrEqual(500);
    expect(block.text).toContain("file_path:");
    expect(block.text).toContain("Preview:");
    expect(block.text).toContain("Use the read tool");

    const files = await readdir(join(root, "web"));
    expect(files).toHaveLength(1);
    expect(files[0]).toMatch(/^fetch-.*\.md$/);
    const stored = await readFile(join(root, "web", files[0]!), "utf8");
    expect(stored).toContain("External web content follows");
    expect(stored).toContain(body);
  });

  it("does not write a spill when even its metadata cannot fit the output budget", async () => {
    ctx = new Context();
    await ctx.plugin(ToolService);
    await ctx.plugin(FetchTool, {
      core: new MockFetchCore([{ kind: "result", result: {
        url: "https://example.test/tiny-budget",
        statusCode: 200,
        body: { kind: "text", format: "plain", content: "x".repeat(1000) },
      } }]),
      maxOutputCharacters: 10,
      spill: { resolveFileEnvironment: () => ({ cwd: root }) },
    });

    await expect(ctx.tools.execute(call("tiny-budget"), signal, { sessionId }))
      .resolves.toMatchObject({ kind: "failure" });
    await expect(readdir(join(root, "web"))).rejects.toMatchObject({ code: "ENOENT" });
  });
});

function call(id: string) {
  return {
    type: "tool-call" as const,
    id: createToolCallId(id),
    name: "web_fetch",
    arguments: JSON.stringify({ url: `https://example.test/${id}` }),
  };
}
