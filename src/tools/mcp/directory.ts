import { Service, type Context } from "cordis";

import type { JsonObject } from "../../llm/types.js";
import { snapshotParameters } from "../schema.js";
import { McpDirectoryError } from "./errors.js";
import type { McpConnection, McpConnectionFactory, McpRemoteTool } from "./client.js";
import { createMcpConnection } from "./client.js";
import type { McpClientConfig, McpDirectorySnapshot, McpDiscoveredTool, McpServerConfig, McpServerDiscoveryStatus } from "./types.js";

export class McpDirectoryService extends Service {
  private readonly config: McpClientConfig;
  private readonly factory: McpConnectionFactory;
  private readonly connections = new Map<string, McpConnection>();
  private snapshot: McpDirectorySnapshot = Object.freeze({ revision: 0, servers: Object.freeze([]), tools: Object.freeze([]) });
  private revision = 0;
  private stopped = false;
  private started = false;
  private refreshing: Promise<McpDirectorySnapshot> | undefined;

  constructor(ctx: Context, config: McpClientConfig, factory: McpConnectionFactory = createMcpConnection) {
    super(ctx, "mcpDirectory");
    this.config = config;
    this.factory = factory;
    ctx.effect(() => () => { void this.stop(); }, "mcp.directory.lifecycle");
  }

  async start(): Promise<void> {
    if (this.stopped) throw new McpDirectoryError("stopped", "MCP directory service is stopped.");
    if (this.started) return;
    this.started = true;
    await this.refresh();
  }

  getSnapshot(): McpDirectorySnapshot { return this.snapshot; }

  async refresh(): Promise<McpDirectorySnapshot> {
    if (this.stopped) throw new McpDirectoryError("stopped", "MCP directory service is stopped.");
    if (this.refreshing !== undefined) return this.refreshing;
    const operation = this.refreshAll();
    this.refreshing = operation;
    try { return await operation; }
    finally { if (this.refreshing === operation) this.refreshing = undefined; }
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.stopped = true;
    const connections = [...this.connections.values()];
    this.connections.clear();
    await Promise.all(connections.map(closeQuietly));
    await this.refreshing?.catch(() => undefined);
  }

  private async refreshAll(): Promise<McpDirectorySnapshot> {
    const servers: McpServerDiscoveryStatus[] = [];
    const tools: McpDiscoveredTool[] = [];
    for (const server of this.config.servers) {
      if (this.stopped) throw new McpDirectoryError("stopped", "MCP directory service is stopped.");
      let connection = this.connections.get(server.id);
      const created = connection === undefined;
      try {
        if (connection === undefined) {
          connection = this.factory(server);
          this.connections.set(server.id, connection);
          await connection.connect();
        }
        const remoteTools = await connection.listTools();
        if (this.stopped) throw new McpDirectoryError("stopped", "MCP directory service is stopped.");
        const discovered = normalizeMcpTools(server, remoteTools);
        tools.push(...discovered);
        servers.push(Object.freeze({ serverId: server.id, status: "ready", toolCount: discovered.length }));
      } catch (error: unknown) {
        if (connection !== undefined) {
          if (this.connections.get(server.id) === connection) this.connections.delete(server.id);
          await closeQuietly(connection);
        }
        if (this.stopped) throw error;
        servers.push(Object.freeze({
          serverId: server.id,
          status: error instanceof McpDirectoryError && error.code === "directory-invalid" ? "error" : "error",
          code: error instanceof McpDirectoryError && error.code === "directory-invalid" ? "directory-invalid" : created ? "connection-failed" : "refresh-failed",
          message: error instanceof McpDirectoryError && error.code === "directory-invalid"
            ? "The MCP server returned an invalid or ambiguous tool directory."
            : created ? "The MCP server could not be connected or its tool directory could not be read." : "The MCP tool directory could not be refreshed; the connection was closed.",
        }));
      }
    }
    this.revision += 1;
    this.snapshot = deepFreeze({ revision: this.revision, servers, tools });
    return this.snapshot;
  }
}

export function normalizeMcpTools(server: McpServerConfig, remoteTools: readonly McpRemoteTool[]): readonly McpDiscoveredTool[] {
  const names = new Set<string>();
  const tools = remoteTools.map(tool => {
    if (typeof tool.name !== "string" || !tool.name.trim() || names.has(tool.name)) throw new McpDirectoryError("directory-invalid", "MCP tool names must be non-empty and unique within a server.");
    names.add(tool.name);
    const inputSchema = asJsonObject(tool.inputSchema);
    if (inputSchema === undefined) throw new McpDirectoryError("directory-invalid", "MCP tool input schemas must be JSON objects.");
    const qualifiedName = "mcp:" + server.id + "/" + tool.name;
    let schemaCompatibility: McpDiscoveredTool["schemaCompatibility"];
    try { snapshotParameters(inputSchema, qualifiedName); schemaCompatibility = { kind: "supported" }; }
    catch (error: unknown) {
      schemaCompatibility = { kind: "unsupported", reason: error instanceof Error ? error.message : "The input schema is not supported by Navo." };
    }
    return { qualifiedName, serverId: server.id, name: tool.name, ...(tool.description === undefined ? {} : { description: tool.description }), inputSchema, schemaCompatibility };
  });
  return deepFreeze(tools);
}

function asJsonObject(value: unknown): JsonObject | undefined {
  if (!isRecord(value)) return undefined;
  try { const cloned = JSON.parse(JSON.stringify(value)) as unknown; return isRecord(cloned) ? cloned as JsonObject : undefined; }
  catch { return undefined; }
}
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === "object" && !Array.isArray(value); }
async function closeQuietly(connection: McpConnection): Promise<void> { try { await connection.close(); } catch { return; } }
function deepFreeze<T>(value: T, seen = new Set<object>()): T {
  if (value === null || typeof value !== "object" || seen.has(value)) return value;
  seen.add(value);
  for (const child of Object.values(value)) deepFreeze(child, seen);
  return Object.freeze(value) as T;
}

declare module "cordis" { interface Context { mcpDirectory?: McpDirectoryService } }
