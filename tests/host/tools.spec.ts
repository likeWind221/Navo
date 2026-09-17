import { describe, expect, it } from "vitest";
import { createApp } from "../../src/app.js";
import { createToolCallId } from "../../src/brand/ids.js";
import { resolveKernelHostConfig } from "../../src/host/config.js";
import { createAgentTurnV2Handler } from "../../src/host/turn/v2.js";
import { MockLLMAdapter } from "../../src/llm/adapters/mock.js";

import { createFileEnvironment } from "../../src/tools/builtins/file/path.js";
import { READ_NODE_TOOL_NAME } from "../../src/tools/builtins/roadmap/read-node.js";
import { READ_ROADMAP_TOOL_NAME } from "../../src/tools/builtins/roadmap/read.js";
import { WRITE_ROADMAP_TOOL_NAME } from "../../src/tools/builtins/roadmap/write-roadmap.js";
import { ExaSearchAdapter } from "../../src/tools/builtins/search/adapters/exa.js";
import { modelResponse } from "../helpers/runtime.js";

describe("desktop Host tool availability", () => {
  it.each([
    { search: false, file: false, expected: ["web_fetch", "read", "shell", "edit", "write"] },
    { search: true, file: false, expected: ["web_search", "web_fetch", "read", "shell", "edit", "write"] },
    { search: false, file: true, expected: ["web_fetch", "read", "shell", "edit", "write"] },
    { search: true, file: true, expected: ["web_search", "web_fetch", "read", "shell", "edit", "write"] },
  ])("advertises configured tools to the model: search=$search file=$file", async ({ search, file, expected }) => {
    const config = resolveKernelHostConfig({
      ...(search ? { EXA_API_KEY: "test-key" } : {}),
      ...(file ? { NAVO_FILE_CWD: process.cwd() } : {}),
    });
    const environment = config.file === undefined
      ? undefined : await createFileEnvironment(config.file.cwd);
    const ctx = await createApp({
      node: { session: { model: config.agent.model } },
      tools: {
        ...(config.search === undefined ? {} : { search: { adapter: new ExaSearchAdapter(config.search) } }),
        ...(environment === undefined ? {} : { file: { resolveFileEnvironment: () => environment } }),
      },
    });
    try {
      const registered = ctx.tools.schemas().map(tool => tool.name).sort();
      expect(registered).toEqual([
        "web_search", "web_fetch",
        "read", "shell", "edit", "write",
        READ_ROADMAP_TOOL_NAME, READ_NODE_TOOL_NAME, WRITE_ROADMAP_TOOL_NAME,
      ].sort());
      const adapter = new MockLLMAdapter([
        modelResponse([{
          type: "tool-call", id: createToolCallId("read-package"), name: "read",
          arguments: JSON.stringify({ path: "package.json", maxLines: 5 }),
        }], "tool-calls"),
        modelResponse([{ type: "text", text: "ready" }]),
      ]);
      ctx.llm.registerAdapter(config.provider, adapter);
      const events = [];
      const handler = createAgentTurnV2Handler(ctx, config.agent);
      for await (const event of handler({
        sessionId: "tool-audit", requestId: "tool-audit-turn", text: "List available tools",
      }, new AbortController().signal)) events.push(event);
      expect(adapter.requests).toHaveLength(2);
      expect(JSON.stringify(adapter.requests[1]?.messages)).toContain('navo');
      expect(events).toEqual(expect.arrayContaining([
        expect.objectContaining({ type: "tool-result", status: "succeeded", detail: expect.stringContaining('"name": "navo"') }),
      ]));
      expect(adapter.requests[0]?.tools?.map(tool => tool.name).sort()).toEqual([...expected].sort());
      expect(adapter.requests[0]?.tools?.map(tool => tool.name)).not.toContain(READ_ROADMAP_TOOL_NAME);
      expect(adapter.requests[0]?.tools?.map(tool => tool.name)).not.toContain(READ_NODE_TOOL_NAME);
      expect(adapter.requests[0]?.tools?.map(tool => tool.name)).not.toContain(WRITE_ROADMAP_TOOL_NAME);
      expect(events.at(-1)).toMatchObject({ type: "turn-completed" });
    } finally {
      await ctx.fiber.dispose();
    }
  });
});
