import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { Context } from "cordis";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { createSessionId, createToolCallId } from "../../../src/brand/ids.js";
import { MockFetchCore } from "../../../src/tools/builtins/fetch/mock.js";
import { MockSearchAdapter } from "../../../src/tools/builtins/search/adapters/mock.js";
import { ToolsPlugin } from "../../../src/tools/plugin.js";

let root: string;
let ctx: Context | undefined;
const signal = new AbortController().signal;
const sessionId = createSessionId("file-plugin-session");

beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "skillworld-file-plugin-")); });
afterEach(async () => {
  await ctx?.fiber.dispose();
  ctx = undefined;
  await rm(root, { recursive: true, force: true });
});

describe("ToolsPlugin file capability", () => {
  it("keeps file tools unregistered until the host explicitly enables a file environment", async () => {
    ctx = new Context();
    await ctx.plugin(ToolsPlugin, {
      search: { adapter: new MockSearchAdapter([]) },
      fetch: { core: new MockFetchCore([]) },
    });

    expect(ctx.tools.schemas().map((tool) => tool.name)).not.toEqual(
      expect.arrayContaining(["read", "shell", "edit", "write"]),
    );
  });

  it("registers four file tools over one observation store", async () => {
    await writeFile(join(root, "existing.txt"), "old", "utf8");
    ctx = new Context();
    await ctx.plugin(ToolsPlugin, {
      search: { adapter: new MockSearchAdapter([]) },
      fetch: { core: new MockFetchCore([]) },
      file: { resolveFileEnvironment: () => ({ cwd: root }) },
    });

    expect(ctx.tools.schemas().map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["read", "shell", "edit", "write"]),
    );

    const blind = await ctx.tools.execute(
      call("blind", "write", { path: "existing.txt", content: "blind" }),
      signal,
      { sessionId },
    );
    expect(blind).toMatchObject({
      kind: "failure",
      failure: { modelMessage: "Read the existing file in this Session before replacing it." },
    });
    expect(await readFile(join(root, "existing.txt"), "utf8")).toBe("old");

    await expect(ctx.tools.execute(
      call("read", "read", { path: "existing.txt" }), signal, { sessionId },
    )).resolves.toMatchObject({ kind: "success" });
    await expect(ctx.tools.execute(
      call("write", "write", { path: "existing.txt", content: "new" }),
      signal,
      { sessionId },
    )).resolves.toMatchObject({ kind: "success" });
    expect(await readFile(join(root, "existing.txt"), "utf8")).toBe("new");
  });

  it("keeps Shell independent from file observation state", async () => {
    await writeFile(join(root, "existing.txt"), "old", "utf8");
    ctx = new Context();
    await ctx.plugin(ToolsPlugin, {
      search: { adapter: new MockSearchAdapter([]) },
      fetch: { core: new MockFetchCore([]) },
      file: { resolveFileEnvironment: () => ({ cwd: root }) },
    });

    await expect(ctx.tools.execute(
      call("read-before-shell", "read", { path: "existing.txt" }), signal, { sessionId },
    )).resolves.toMatchObject({ kind: "success" });
    await expect(ctx.tools.execute(
      call("shell", "shell", { command: "echo ok" }), signal, { sessionId },
    )).resolves.toMatchObject({ kind: "success" });
    await expect(ctx.tools.execute(
      call("write-after-shell", "write", { path: "existing.txt", content: "new" }),
      signal,
      { sessionId },
    )).resolves.toMatchObject({ kind: "success" });
    expect(await readFile(join(root, "existing.txt"), "utf8")).toBe("new");
  });
});

function call(id: string, name: string, args: unknown) {
  return {
    type: "tool-call" as const,
    id: createToolCallId(id),
    name,
    arguments: JSON.stringify(args),
  };
}
