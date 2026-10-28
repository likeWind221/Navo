import { Context } from "cordis";
import { describe, expect, it, vi } from "vitest";
import { McpDirectoryService } from "../../../src/tools/mcp/directory.js";
import type { McpConnection, McpRemoteTool } from "../../../src/tools/mcp/client.js";
import type { McpClientConfig } from "../../../src/tools/mcp/types.js";

const config: McpClientConfig = { servers: [{ id: "alpha", url: "https://example.com/mcp" }] };
function connection(tools: readonly McpRemoteTool[]): McpConnection {
  return { connect: vi.fn(async () => undefined), listTools: vi.fn(async () => tools), close: vi.fn(async () => undefined) };
}

describe("McpDirectoryService", () => {
  it("discovers and qualifies tools and marks unsupported schemas", async () => {
    const remote = connection([
      { name: "lookup", description: "Look up a record", inputSchema: { type: "object", properties: { query: { type: "string" } }, required: ["query"], additionalProperties: false } },
      { name: "bounded_lookup", inputSchema: { type: "object", properties: { limit: { type: "integer", minimum: 1 } }, additionalProperties: false } },
    ]);
    const ctx = new Context();
    const directory = new McpDirectoryService(ctx, config, () => remote);
    await directory.start();
    const snapshot = directory.getSnapshot();
    expect(snapshot.revision).toBe(1);
    expect(snapshot.servers).toEqual([{ serverId: "alpha", status: "ready", toolCount: 2 }]);
    expect(snapshot.tools.map(tool => tool.qualifiedName)).toEqual(["mcp:alpha/lookup", "mcp:alpha/bounded_lookup"]);
    expect(snapshot.tools[0]?.schemaCompatibility).toEqual({ kind: "supported" });
    expect(snapshot.tools[1]?.schemaCompatibility.kind).toBe("unsupported");
    await directory.stop();
    await ctx.fiber.dispose();
  });
  it("rejects duplicate tool names without exposing an ambiguous directory", async () => {
    const remote = connection([{ name: "same", inputSchema: { type: "object" } }, { name: "same", inputSchema: { type: "object" } }]);
    const ctx = new Context();
    const directory = new McpDirectoryService(ctx, config, () => remote);
    await directory.start();
    expect(directory.getSnapshot().servers[0]?.status).toBe("error");
    expect(directory.getSnapshot().tools).toEqual([]);
    await directory.stop();
    await ctx.fiber.dispose();
  });
  it("does not expose connection diagnostics and closes failed connections", async () => {
    const remote: McpConnection = { connect: vi.fn(async () => { throw new Error("private transport diagnostic"); }), listTools: vi.fn(async () => []), close: vi.fn(async () => undefined) };
    const ctx = new Context();
    const directory = new McpDirectoryService(ctx, config, () => remote);
    await directory.start();
    expect(directory.getSnapshot().servers[0]?.status).toBe("error");
    expect(JSON.stringify(directory.getSnapshot())).not.toContain("private transport diagnostic");
    expect(remote.close).toHaveBeenCalledOnce();
    await directory.stop();
    await ctx.fiber.dispose();
  });
  it("refreshes and closes the connection when a refresh fails", async () => {
    const remote = connection([{ name: "first", inputSchema: { type: "object" } }]);
    const ctx = new Context();
    const directory = new McpDirectoryService(ctx, config, () => remote);
    await directory.start();
    vi.mocked(remote.listTools).mockRejectedValueOnce(new Error("offline"));
    const refreshed = await directory.refresh();
    expect(refreshed.revision).toBe(2);
    expect(refreshed.tools).toEqual([]);
    expect(remote.close).toHaveBeenCalledOnce();
    await directory.stop();
    await ctx.fiber.dispose();
  });
});
