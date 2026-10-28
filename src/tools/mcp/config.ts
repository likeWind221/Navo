import type { McpClientConfig, McpServerConfig } from "./types.js";

const MAX_SERVERS = 32;
const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const RESERVED_HEADERS = new Set(["accept", "connection", "content-length", "content-type", "host", "last-event-id", "mcp-protocol-version", "mcp-session-id", "transfer-encoding"]);

export function resolveMcpClientConfig(env: NodeJS.ProcessEnv = process.env): McpClientConfig | undefined {
  const raw = env.NAVO_MCP_SERVERS_JSON;
  if (raw === undefined) return undefined;
  if (!raw.trim()) throw new TypeError("NAVO_MCP_SERVERS_JSON must be a non-empty JSON array.");
  let parsed: unknown;
  try { parsed = JSON.parse(raw) as unknown; }
  catch (cause: unknown) { throw new TypeError("NAVO_MCP_SERVERS_JSON must contain valid JSON.", { cause }); }
  if (!Array.isArray(parsed) || parsed.length > MAX_SERVERS) throw new TypeError("NAVO_MCP_SERVERS_JSON must be an array of at most 32 MCP servers.");
  const ids = new Set<string>();
  const servers = parsed.map(value => {
    const server = parseServer(value);
    if (ids.has(server.id)) throw new TypeError("MCP server IDs must be unique.");
    ids.add(server.id);
    return server;
  });
  return Object.freeze({ servers: Object.freeze(servers) });
}

function parseServer(value: unknown): McpServerConfig {
  if (!isRecord(value)) throw new TypeError("Each MCP server entry must be an object.");
  if (Object.keys(value).some(key => !["id", "url", "headers"].includes(key))) throw new TypeError("MCP server entries may contain only id, url and headers.");
  const id = value.id;
  if (typeof id !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(id)) throw new TypeError("MCP server IDs must be 1–64 ASCII letters, digits, underscores or hyphens, starting with a letter or digit.");
  const rawUrl = value.url;
  if (typeof rawUrl !== "string" || !rawUrl.trim() || rawUrl !== rawUrl.trim()) throw new TypeError("MCP server URLs must be non-empty absolute HTTP(S) URLs.");
  let url: URL;
  try { url = new URL(rawUrl); }
  catch (cause: unknown) { throw new TypeError("MCP server URLs must be non-empty absolute HTTP(S) URLs.", { cause }); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password || url.search || url.hash) throw new TypeError("MCP server URLs must use HTTP(S) and must not embed credentials, query strings or fragments.");
  const headers = value.headers === undefined ? undefined : parseHeaders(value.headers);
  return Object.freeze({ id, url: url.href, ...(headers === undefined ? {} : { headers }) });
}

function parseHeaders(value: unknown): Readonly<Record<string, string>> {
  if (!isRecord(value)) throw new TypeError("MCP headers must be an object of string values.");
  const headers: Record<string, string> = {};
  for (const [name, headerValue] of Object.entries(value)) {
    if (!HEADER_NAME.test(name) || RESERVED_HEADERS.has(name.toLowerCase())) throw new TypeError("MCP headers contain an invalid or protocol-reserved header name.");
    if (typeof headerValue !== "string" || /[\r\n]/.test(headerValue)) throw new TypeError("MCP header values must be strings without newlines.");
    headers[name] = headerValue;
  }
  return Object.freeze(headers);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}
