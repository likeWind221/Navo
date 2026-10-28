import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import type { McpServerConfig } from "./types.js";

export interface McpRemoteTool {
  readonly name: string;
  readonly description?: string;
  readonly inputSchema: unknown;
}

export interface McpConnection {
  connect(): Promise<void>;
  listTools(): Promise<readonly McpRemoteTool[]>;
  close(): Promise<void>;
}

export type McpConnectionFactory = (server: McpServerConfig) => McpConnection;

export const createMcpConnection: McpConnectionFactory = server => {
  const client = new Client({ name: "navo", version: "0.0.0" }, { listMaxPages: 64, timeout: 15_000 });
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    ...(server.headers === undefined ? {} : { requestInit: { headers: { ...server.headers } } }),
  });
  return {
    async connect() { await client.connect(transport); },
    async listTools() {
      return (await client.listTools(undefined, { cacheMode: "refresh", timeout: 15_000 })).tools;
    },
    async close() { await client.close(); },
  };
};
