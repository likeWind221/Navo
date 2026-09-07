import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { createToolCallId } from "../../../src/brand/ids.js";
import { FetchError } from "../../../src/tools/builtins/fetch/errors.js";
import { FETCH_OUTPUT_LIMITS } from "../../../src/tools/builtins/fetch/output.js";
import { MockFetchCore } from "../../../src/tools/builtins/fetch/mock.js";
import { FetchTool, WEB_FETCH_TOOL_NAME } from "../../../src/tools/builtins/fetch/tool.js";
import { ToolService } from "../../../src/tools/service.js";

const contexts = new Set<Context>();
const signal = new AbortController().signal;

afterEach(async () => {
  await Promise.all([...contexts].map((ctx) => ctx.fiber.dispose()));
  contexts.clear();
});

describe("web_fetch tool", () => {
  it("registers its exact schema and unloads", async () => {
    const { ctx, fiber } = await createTool(new MockFetchCore([]));

    expect(ctx.tools.schemas()).toEqual([{
      name: WEB_FETCH_TOOL_NAME,
      description: expect.stringContaining("untrusted"),
      parameters: {
        type: "object",
        properties: {
          url: { type: "string", description: expect.any(String) },
        },
        required: ["url"],
        additionalProperties: false,
      },
    }]);

    await fiber.dispose();
    expect(ctx.tools.schemas()).toEqual([]);
  });

  it("converts HTML, removes hidden content, and labels it untrusted", async () => {
    const core = new MockFetchCore([{ kind: "result", result: {
      url: "https://example.test/article",
      statusCode: 200,
      body: {
        kind: "html",
        content: "<h1>Title</h1><script>steal()</script><p>Visible <strong>text</strong>.</p><p hidden>secret</p>",
      },
    } }]);
    const { ctx } = await createTool(core);

    const result = await ctx.tools.execute(call("html"), signal);

    expect(result.kind).toBe("success");
    const output = result.block.content[0];
    if (output?.type !== "text") throw new Error("Expected Fetch text output.");
    const text = output.text;
    expect(text).toContain("# Title");
    expect(text).toContain("Visible **text**");
    expect(text).toContain("External web content follows");
    expect(text).not.toContain("steal");
    expect(text).not.toContain("secret");
  });

  it("rejects output that cannot be returned as a complete document", async () => {
    const core = new MockFetchCore([{ kind: "result", result: {
      url: "https://example.test/long",
      statusCode: 200,
      body: { kind: "text", format: "plain", content: "x".repeat(5_000) },
    } }]);
    const { ctx } = await createTool(core, 300);

    const result = await ctx.tools.execute(call("long"), signal);
    expect(result).toMatchObject({
      kind: "failure",
      failure: { modelMessage: "The web response is too large to return as a complete document." },
    });
    expect(FETCH_OUTPUT_LIMITS.defaultCharacters).toBeGreaterThan(300);
  });

  it("obeys allowlists and exposes only fixed error text", async () => {
    const core = new MockFetchCore([{ kind: "error", error: new FetchError(
      "network-failed",
      "authorization=secret at private host",
    ) }]);
    const { ctx } = await createTool(core);

    const denied = await ctx.tools.execute(call("denied"), signal, {
      allowedTools: [],
    });
    const failed = await ctx.tools.execute(call("failed"), signal);

    expect(denied).toMatchObject({
      kind: "failure",
      failure: { code: "tool-not-allowed" },
    });
    expect(failed).toMatchObject({
      kind: "failure",
      failure: {
        code: "tool-failed",
        modelMessage: "The web fetch request failed.",
      },
    });
    expect(JSON.stringify(failed)).not.toContain("secret");
  });

  it("cancels hanging work when unloaded", async () => {
    const core = new MockFetchCore([{ kind: "hang" }]);
    const { ctx, fiber } = await createTool(core);
    const pending = ctx.tools.execute(call("unload"), signal);
    await Promise.resolve();

    await fiber.dispose();

    await expect(pending).resolves.toMatchObject({
      kind: "failure",
      failure: {
        code: "tool-failed",
        modelMessage: "The web fetch request was cancelled.",
      },
    });
    expect(ctx.tools.schemas()).toEqual([]);
  });
});

async function createTool(core: MockFetchCore, maxOutputCharacters?: number) {
  const ctx = new Context();
  contexts.add(ctx);
  await ctx.plugin(ToolService);
  const fiber = await ctx.plugin(FetchTool, {
    core,
    ...(maxOutputCharacters === undefined ? {} : { maxOutputCharacters }),
  });
  return { ctx, fiber };
}

function call(id: string) {
  return {
    type: "tool-call" as const,
    id: createToolCallId(id),
    name: WEB_FETCH_TOOL_NAME,
    arguments: JSON.stringify({ url: `https://example.test/${id}` }),
  };
}
