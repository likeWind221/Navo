import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { join } from "node:path";
import { Context } from "cordis";
import { createToolCallId } from "../src/brand/ids.js";
import { ToolService } from "../src/tools/service.js";
import { SearchService } from "../src/tools/builtins/search/service.js";
import { SearchTool, WEB_SEARCH_TOOL_NAME } from "../src/tools/builtins/search/tool.js";
import { ExaSearchAdapter } from "../src/tools/builtins/search/adapters/exa.js";

/** Explicit opt-in: reads an existing local secret without copying it to project files. */
async function main(): Promise<void> {
  if (!process.argv.includes("--live")) {
    console.log("No request sent. Run: pnpm exec tsx scripts/search-smoke.ts --live");
    return;
  }
  const apiKey = await readExaKey();
  const ctx = new Context();
  const controller = new AbortController();
  function stop(): void { controller.abort(); }
  process.once("SIGINT", stop);
  try {
    await ctx.plugin(ToolService);
    await ctx.plugin(SearchService, { defaultProvider: "exa" });
    ctx.search.registerAdapter(new ExaSearchAdapter({ apiKey }));
    await ctx.plugin(SearchTool);
    const result = await ctx.tools.execute({
      type: "tool-call",
      id: createToolCallId(randomUUID()),
      name: WEB_SEARCH_TOOL_NAME,
      arguments: JSON.stringify({ query: "TypeScript official handbook generics", maxResults: 2 }),
    }, controller.signal, { allowedTools: [WEB_SEARCH_TOOL_NAME] });
    if (result.kind === "failure") {
      // Even safe model text is unnecessary in this credential-bearing smoke process.
      console.error(`Search smoke failed (${result.failure.code}).`);
      process.exitCode = 1;
    } else {
      const text = result.block.content.map((block) => block.type === "text" ? block.text : "").join("\n");
      console.log(`Search smoke passed via tool entry (${text.length} output characters).`);
      // Do not print external response text: it is untrusted and unnecessary here.
    }
  } finally {
    process.removeListener("SIGINT", stop);
    controller.abort();
    await ctx.fiber.dispose();
  }
}

async function readExaKey(): Promise<string> {
  let config: unknown;
  try {
    config = JSON.parse(await readFile(join(homedir(), ".claude.json"), "utf8"));
  } catch {
    throw new Error("Unable to read local Claude Code MCP configuration.");
  }
  const servers = record(record(config)?.mcpServers);
  const exa = record(servers?.exa);
  const headers = record(exa?.headers);
  const key = headers?.["x-api-key"];
  if (typeof key !== "string" || !key.trim()) {
    throw new Error("Exa x-api-key is missing from local Claude Code MCP configuration.");
  }
  return key;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown> : undefined;
}

void main().catch(() => {
  console.error("Search smoke failed; check local MCP key configuration and connectivity. No credentials were printed.");
  process.exitCode = 1;
});
