import { describe, expect, it } from "vitest";
import { resolveMcpClientConfig } from "../../../src/tools/mcp/config.js";

describe("resolveMcpClientConfig", () => {
  it("keeps MCP disabled without trusted configuration", () => {
    expect(resolveMcpClientConfig({})).toBeUndefined();
  });
  it("parses and freezes explicit server configuration", () => {
    const config = resolveMcpClientConfig({ NAVO_MCP_SERVERS_JSON: JSON.stringify([{ id: "appworld", url: "http://127.0.0.1:8000/mcp", headers: { Authorization: "Bearer private-token" } }]) });
    expect(config?.servers[0]).toEqual({ id: "appworld", url: "http://127.0.0.1:8000/mcp", headers: { Authorization: "Bearer private-token" } });
    expect(Object.isFrozen(config?.servers)).toBe(true);
    expect(Object.isFrozen(config?.servers[0]?.headers)).toBe(true);
  });
  it.each([
    ["malformed JSON", "{"],
    ["non-array JSON", "{}"],
    ["duplicate IDs", JSON.stringify([{ id: "same", url: "https://example.com/mcp" }, { id: "same", url: "https://example.org/mcp" }])],
    ["embedded credentials", JSON.stringify([{ id: "x", url: "https://user:pass@example.com/mcp" }])],
    ["URL query strings", JSON.stringify([{ id: "x", url: "https://example.com/mcp?token=secret" }])],
    ["reserved headers", JSON.stringify([{ id: "x", url: "https://example.com/mcp", headers: { "Mcp-Session-Id": "abc" } }])],
    ["newline header values", JSON.stringify([{ id: "x", url: "https://example.com/mcp", headers: { Authorization: "Bearer x\r\ny" } }])],
  ])("rejects %s", (_label, value) => {
    expect(() => resolveMcpClientConfig({ NAVO_MCP_SERVERS_JSON: value })).toThrow(TypeError);
  });
});
