import { Context } from "cordis";
import { describe, expect, it } from "vitest";
import { ToolsPlugin } from "../../../src/tools/plugin.js";

describe("MCP tool plugin", () => {
  it("mounts and starts the directory service from trusted configuration", async () => {
    const ctx = new Context();
    await ctx.plugin(ToolsPlugin, { mcp: { servers: [] } });
    expect(ctx.mcpDirectory?.getSnapshot()).toEqual({ revision: 1, servers: [], tools: [] });
    await ctx.fiber.dispose();
  });
});
