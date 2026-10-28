import { once } from "node:events";
import { createServer, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

import { Context } from "cordis";
import { afterEach, describe, expect, it } from "vitest";

import { McpDirectoryService } from "../../../src/tools/mcp/directory.js";
import type { McpClientConfig } from "../../../src/tools/mcp/types.js";

interface MockServer {
  readonly url: string;
  readonly authorizations: string[];
}

const servers: Server[] = [];

afterEach(async () => {
  while (servers.length > 0) {
    const server = servers.pop();
    if (server === undefined) continue;
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => {
      server.close(error => error === undefined ? resolve() : reject(error));
    });
  }
});

describe("McpDirectoryService over Streamable HTTP", () => {
  it("discovers every tool page and keeps credentials out of the snapshot", async () => {
    const mock = await startMockServer();
    const config: McpClientConfig = {
      servers: [{ id: "remote", url: mock.url, headers: { Authorization: "Bearer test-token" } }],
    };
    const ctx = new Context();
    const directory = new McpDirectoryService(ctx, config);
    try {
      await directory.start();
      const snapshot = directory.getSnapshot();
      expect(snapshot.servers).toEqual([
        { serverId: "remote", status: "ready", toolCount: 2, protocolVersion: expect.any(String) },
      ]);
      expect(snapshot.tools.map(tool => tool.qualifiedName)).toEqual(["mcp:remote/search", "mcp:remote/lookup"]);
      expect(JSON.stringify(snapshot)).not.toContain("test-token");
      expect(mock.authorizations.every(value => value === "Bearer test-token")).toBe(true);

      const refreshed = await directory.refresh();
      expect(refreshed.revision).toBe(2);
      expect(refreshed.tools.map(tool => tool.qualifiedName)).toEqual(["mcp:remote/search", "mcp:remote/lookup"]);
    } finally {
      await directory.stop();
      await ctx.fiber.dispose();
    }
  });

  it("reports an unsupported protocol version from a real server", async () => {
    const mock = await startMockServer({ unsupportedProtocol: true });
    const config: McpClientConfig = {
      servers: [{ id: "remote", url: mock.url, headers: { Authorization: "Bearer test-token" } }],
    };
    const ctx = new Context();
    const directory = new McpDirectoryService(ctx, config);
    try {
      await directory.start();
      expect(directory.getSnapshot().servers).toEqual([
        expect.objectContaining({
          serverId: "remote",
          status: "error",
          code: "version-unsupported",
          message: "The MCP server does not support a protocol version accepted by Navo.",
        }),
      ]);
    } finally {
      await directory.stop();
      await ctx.fiber.dispose();
    }
  });
});

async function startMockServer(options: { unsupportedProtocol?: boolean } = {}): Promise<MockServer> {
  const authorizations: string[] = [];
  const server = createServer((request, response) => {
    let body = "";
    request.on("data", chunk => { body += chunk; });
    request.on("end", () => {
      authorizations.push(request.headers.authorization ?? "");
      if (request.method !== "POST") {
        response.writeHead(request.method === "DELETE" ? 200 : 405);
        response.end();
        return;
      }
      let message: { id?: unknown; method?: string; params?: { cursor?: string; protocolVersion?: string } };
      try {
        message = JSON.parse(body) as typeof message;
      } catch {
        response.writeHead(400);
        response.end();
        return;
      }
      if (message.method === "initialize" && request.headers.authorization !== "Bearer test-token") {
        response.writeHead(401);
        response.end();
        return;
      }
      if (message.method === "initialize" && options.unsupportedProtocol === true) {
        send(response, {
          jsonrpc: "2.0",
          id: message.id,
          error: {
            code: -32022,
            message: "Unsupported protocol version",
            data: { supported: ["2027-01-01"], requested: message.params?.protocolVersion },
          },
        });
        return;
      }
      if (message.method === "initialize") {
        send(response, {
          jsonrpc: "2.0",
          id: message.id,
          result: {
            protocolVersion: message.params?.protocolVersion ?? "2025-06-18",
            capabilities: { tools: { listChanged: true } },
            serverInfo: { name: "mock-mcp", version: "1.0.0" },
          },
        });
        return;
      }
      if (message.method === "notifications/initialized") {
        response.writeHead(202);
        response.end();
        return;
      }
      if (message.method === "tools/list") {
        send(response, {
          jsonrpc: "2.0",
          id: message.id,
          result: message.params?.cursor === undefined
            ? { tools: [tool("search")], nextCursor: "page-2" }
            : { tools: [tool("lookup")] },
        });
        return;
      }
      send(response, { jsonrpc: "2.0", id: message.id, error: { code: -32601, message: "method not found" } });
    });
  });
  servers.push(server);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return { url: `http://127.0.0.1:${address.port}/mcp`, authorizations };
}

function tool(name: string): { name: string; description: string; inputSchema: { type: "object"; properties: { query: { type: "string" } }; required: string[]; additionalProperties: false } } {
  return {
    name,
    description: name,
    inputSchema: {
      type: "object",
      properties: { query: { type: "string" } },
      required: ["query"],
      additionalProperties: false,
    },
  };
}

function send(response: ServerResponse, body: unknown): void {
  const payload = JSON.stringify(body);
  response.writeHead(200, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "mcp-session-id": "mock-session",
  });
  response.end(payload);
}
