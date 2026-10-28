import type { JsonObject } from "../../llm/types.js";

export interface McpServerConfig {
  readonly id: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
}

export interface McpClientConfig {
  readonly servers: readonly McpServerConfig[];
}

export type McpSchemaCompatibility =
  | { readonly kind: "supported" }
  | { readonly kind: "unsupported"; readonly reason: string };

export interface McpDiscoveredTool {
  readonly qualifiedName: string;
  readonly serverId: string;
  readonly name: string;
  readonly description?: string | undefined;
  readonly inputSchema: JsonObject;
  readonly schemaCompatibility: McpSchemaCompatibility;
}

export type McpServerDiscoveryStatus =
  | {
      readonly serverId: string;
      readonly status: "ready";
      readonly toolCount: number;
      readonly protocolVersion?: string;
    }
  | {
      readonly serverId: string;
      readonly status: "error";
      readonly code: "connection-failed" | "refresh-failed" | "directory-invalid" | "version-unsupported";
      readonly message: string;
      readonly protocolVersion?: string;
    };

export interface McpDirectorySnapshot {
  readonly revision: number;
  readonly servers: readonly McpServerDiscoveryStatus[];
  readonly tools: readonly McpDiscoveredTool[];
}
