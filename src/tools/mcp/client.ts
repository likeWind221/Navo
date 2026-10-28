import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";

import type { McpServerConfig } from "./types.js";

const CONNECT_TIMEOUT_MS = 15_000;
const LIST_TIMEOUT_MS = 15_000;

export interface McpRemoteTool {
  readonly name: string;
  readonly description?: string | undefined;
  readonly inputSchema: unknown;
}

export interface McpConnection {
  connect(): Promise<void>;
  protocolVersion(): string | undefined;
  listTools(): Promise<readonly McpRemoteTool[]>;
  close(): Promise<void>;
}

export type McpConnectionFactory = (server: McpServerConfig) => McpConnection;

export const createMcpConnection: McpConnectionFactory = server => {
  const client = new Client(
    { name: "navo", version: "0.0.0" },
    { listMaxPages: 64, versionNegotiation: { mode: "legacy" } },
  );
  const transport = new StreamableHTTPClientTransport(new URL(server.url), {
    ...(server.headers === undefined ? {} : { requestInit: { headers: { ...server.headers } } }),
  });
  return {
    async connect() { await client.connect(transport, { timeout: CONNECT_TIMEOUT_MS }); },
    protocolVersion() { return client.getNegotiatedProtocolVersion(); },
    async listTools() {
      return (await client.listTools(undefined, { cacheMode: "refresh", timeout: LIST_TIMEOUT_MS })).tools;
    },
    async close() { await client.close(); },
  };
};
