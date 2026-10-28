import type { DeepSeekAdapterConfig } from "../llm/adapters/deepseek.js";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { AgentTurnHandlerConfig } from "./turn.js";
import type { QwenChatAdapterConfig } from "../llm/adapters/qwen.js";
import { WEB_SEARCH_TOOL_NAME } from "../tools/builtins/search/tool.js";
import { WEB_FETCH_TOOL_NAME } from "../tools/builtins/fetch/tool.js";
import { FILE_TOOL_SCHEMAS } from "../tools/builtins/file/types.js";
import { resolveEmbeddingConfig, type EmbeddingConfig } from "../embedding/provider.js";
import { resolveMcpClientConfig } from "../tools/mcp/config.js";
import type { McpClientConfig } from "../tools/mcp/types.js";

export interface KernelHostSearchConfig {
  readonly apiKey: string;
}

export interface KernelHostFileConfig {
  readonly cwd: string;
  readonly shellJobDir: string;
}

export interface KernelHostStorageConfig {
  readonly path: string;
}

export type KernelHostEmbeddingConfig = EmbeddingConfig;

export type KernelHostGraphAdapterConfig =
  | { readonly provider: "qwen"; readonly baseUrl: string; readonly apiKey?: string; readonly enableThinking: boolean }
  | { readonly provider: "deepseek"; readonly baseUrl: string; readonly apiKey: string; readonly enableThinking: boolean }
  | { readonly provider: "openai"; readonly home: string; readonly accountId?: string };

export interface KernelHostGraphConfig {
  readonly model: { readonly provider: `graph:${"qwen" | "openai" | "deepseek"}`; readonly model: string; readonly maxTokens?: number; readonly temperature?: number };
  readonly compatibilityProvider: "qwen" | "openai" | "deepseek";
  readonly inputTokenBudget: number;
  readonly outputTokenLimit: number;
  readonly adapter: KernelHostGraphAdapterConfig;
}

export type KernelHostConfig = KernelHostCommonConfig & (
  | { readonly provider: "qwen"; readonly adapter: QwenChatAdapterConfig }
  | { readonly provider: "deepseek"; readonly adapter: DeepSeekAdapterConfig }
  | { readonly provider: "openai"; readonly adapter: { readonly home: string; readonly accountId?: string } }
);

interface KernelHostCommonConfig {
  readonly storage: KernelHostStorageConfig;
  readonly agent: AgentTurnHandlerConfig;
  readonly search?: KernelHostSearchConfig;
  readonly file?: KernelHostFileConfig;
  readonly embedding?: KernelHostEmbeddingConfig;
  readonly graph?: KernelHostGraphConfig;
  readonly mcp?: McpClientConfig;
}

const DEFAULT_BASE_URL = "http://192.168.99.2:8090/v1";
const DEFAULT_MODEL = "qwen3.8-27b";
const DEFAULT_MAX_TOKENS = 8_192;
const MAX_OUTPUT_TOKENS = 65_536;
const MAX_CONTEXT_TOKENS = 10_000_000;
const DEFAULT_GRAPH_MAX_TOKENS = 4_096;
const DEFAULT_GRAPH_INPUT_TOKENS = 8_192;
const DEFAULT_GRAPH_OUTPUT_TOKENS = 4_096;

/** Resolve trusted process environment once so credentials stay inside Host. */
export function resolveKernelHostConfig(
  env: NodeJS.ProcessEnv = process.env,
): KernelHostConfig {
  const provider = env.LLM_PROVIDER?.trim() ?? "qwen";
  if (provider !== "qwen" && provider !== "openai" && provider !== "deepseek") {
    throw new TypeError("LLM_PROVIDER must be 'qwen', 'openai' or 'deepseek'.");
  }
  if (provider === "openai") {
    for (const name of ["LLM_MAX_TOKENS", "LLM_TEMPERATURE", "LLM_ENABLE_THINKING", "LLM_API_KEY", "LLM_BASE_URL"]) {
      if (env[name] !== undefined) throw new TypeError(`${name} is not supported by the ChatGPT subscription provider.`);
    }
    if (!env.LLM_MODEL?.trim()) throw new TypeError("LLM_MODEL is required for the ChatGPT subscription provider.");
    if (env.LLM_ACCOUNT_ID !== undefined && !env.LLM_ACCOUNT_ID.trim()) {
      throw new TypeError("LLM_ACCOUNT_ID must be non-empty when provided.");
    }
  }
  const model = env.LLM_MODEL?.trim() || (provider === "deepseek" ? "deepseek-flash" : DEFAULT_MODEL);
  if (provider === "deepseek" && env.LLM_ACCOUNT_ID !== undefined) throw new TypeError("LLM_ACCOUNT_ID is not supported by DeepSeek.");
  const contextWindow = optionalInteger("LLM_CONTEXT_WINDOW", env.LLM_CONTEXT_WINDOW, MAX_CONTEXT_TOKENS);
  const autoCompactLimit = optionalInteger("LLM_AUTO_COMPACT_LIMIT", env.LLM_AUTO_COMPACT_LIMIT, MAX_CONTEXT_TOKENS);
  const modelConfig = {
    provider,
    model,
    ...(provider === "openai" ? {} : {
      maxTokens: boundedInteger("LLM_MAX_TOKENS", env.LLM_MAX_TOKENS, DEFAULT_MAX_TOKENS, MAX_OUTPUT_TOKENS),
    }),
    ...(contextWindow === undefined ? {} : { contextWindow }),
    ...(autoCompactLimit === undefined ? {} : { autoCompactLimit }),
  };
  const apiKey = env.LLM_API_KEY;
  if (apiKey !== undefined && (apiKey.length === 0 || /[\r\n]/.test(apiKey))) {
    throw new TypeError("LLM_API_KEY must be non-empty and must not contain newlines.");
  }
  const exaApiKey = env.EXA_API_KEY;
  if (exaApiKey !== undefined && (!exaApiKey.trim() || !/^[\x21-\x7e]+$/.test(exaApiKey.trim()))) {
    throw new TypeError("EXA_API_KEY must be non-empty printable ASCII.");
  }
  const search = exaApiKey === undefined ? undefined : Object.freeze({ apiKey: exaApiKey });
  const embedding = resolveEmbeddingConfig(env);
  const mcp = resolveMcpClientConfig(env);
  const fileCwd = env.NAVO_FILE_CWD;
  if (fileCwd !== undefined && !fileCwd.trim()) {
    throw new TypeError("NAVO_FILE_CWD must be a non-empty path when provided.");
  }
  const navoHome = env.NAVO_HOME;
  if (navoHome !== undefined && !navoHome.trim()) {
    throw new TypeError("NAVO_HOME must be a non-empty path when provided.");
  }
  const home = resolve(navoHome?.trim() ?? join(homedir(), ".navo"));
  const file = Object.freeze({
    cwd: fileCwd?.trim() ?? process.cwd(),
    shellJobDir: join(home, "cache", "shell"),
  });
  const storage = Object.freeze({ path: join(home, "navo.db") });
  const common = {
    storage,
    agent: Object.freeze({
      model: Object.freeze(modelConfig),
      systemPrompt: "You are Navo, a concise and helpful AI agent.",
      toolNames: Object.freeze([
        ...(search === undefined ? [] : [WEB_SEARCH_TOOL_NAME]),
        WEB_FETCH_TOOL_NAME,
        FILE_TOOL_SCHEMAS.read.name,
        "shell",
        FILE_TOOL_SCHEMAS.edit.name,
        FILE_TOOL_SCHEMAS.write.name,
      ]),
    }),
    ...(search === undefined ? {} : { search }),
    ...(embedding === undefined ? {} : { embedding }),
    ...(mcp === undefined ? {} : { mcp }),
    file,
  };
  if (provider === "deepseek") {
    const key = env.LLM_API_KEY ?? env.DEEPSEEK_API_KEY;
    if (!key || /[\r\n]/.test(key)) throw new TypeError("DEEPSEEK_API_KEY or LLM_API_KEY is required and must not contain newlines.");
    const mainAdapter = Object.freeze({
      baseUrl: normalizeHttpUrl("LLM_BASE_URL", env.LLM_BASE_URL?.trim() || "https://api.deepseek.com"),
      apiKey: key,
      enableThinking: optionalBoolean("LLM_ENABLE_THINKING", env.LLM_ENABLE_THINKING, true),
    });
    const graph = resolveGraphConfig(env, "deepseek", mainAdapter, home);
    return Object.freeze({ ...common, provider, adapter: mainAdapter, ...(graph === undefined ? {} : { graph }) });
  }
  if (provider === "qwen") {
    const mainAdapter = Object.freeze({
      baseUrl: env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL,
      enableThinking: optionalBoolean("LLM_ENABLE_THINKING", env.LLM_ENABLE_THINKING, true),
      ...(apiKey === undefined ? {} : { apiKey }),
    });
    const graph = resolveGraphConfig(env, "qwen", mainAdapter, home);
    return Object.freeze({ ...common, provider, adapter: mainAdapter, ...(graph === undefined ? {} : { graph }) });
  }
  const mainAdapter = Object.freeze({ home, ...(env.LLM_ACCOUNT_ID === undefined ? {} : { accountId: env.LLM_ACCOUNT_ID.trim() }) });
  const graph = resolveGraphConfig(env, "openai", mainAdapter, home);
  return Object.freeze({ ...common, provider, adapter: mainAdapter, ...(graph === undefined ? {} : { graph }) });
}

function resolveGraphConfig(
  env: NodeJS.ProcessEnv,
  mainProvider: "qwen" | "openai" | "deepseek",
  mainAdapter: Extract<KernelHostConfig, { provider: "qwen" | "openai" | "deepseek" }>["adapter"],
  home: string,
): KernelHostGraphConfig | undefined {
  const providerValue = env.GRAPH_PROVIDER?.trim();
  const modelValue = env.GRAPH_MODEL?.trim();
  if (providerValue === undefined && modelValue === undefined) return undefined;
  if (providerValue === undefined || modelValue === undefined) throw new TypeError("GRAPH_PROVIDER and GRAPH_MODEL must be provided together.");
  if (providerValue !== "qwen" && providerValue !== "openai" && providerValue !== "deepseek") throw new TypeError("GRAPH_PROVIDER must be 'qwen', 'openai' or 'deepseek'.");
  if (!modelValue || modelValue.length > 256 || /[\r\n]/.test(modelValue)) throw new TypeError("GRAPH_MODEL must be a non-empty model name of at most 256 characters.");
  const inputTokenBudget = boundedIntegerRange("GRAPH_INPUT_TOKEN_BUDGET", env.GRAPH_INPUT_TOKEN_BUDGET, DEFAULT_GRAPH_INPUT_TOKENS, 2_048, 131_072);
  const outputTokenLimit = boundedIntegerRange("GRAPH_OUTPUT_TOKEN_LIMIT", env.GRAPH_OUTPUT_TOKEN_LIMIT, DEFAULT_GRAPH_OUTPUT_TOKENS, 256, 16_384);
  const model = {
    provider: `graph:${providerValue}` as `graph:${"qwen" | "openai" | "deepseek"}`,
    model: modelValue,
    ...(providerValue === "qwen" ? { maxTokens: env.GRAPH_MAX_TOKENS === undefined
      ? Math.min(DEFAULT_GRAPH_MAX_TOKENS, outputTokenLimit)
      : boundedIntegerRange("GRAPH_MAX_TOKENS", env.GRAPH_MAX_TOKENS, DEFAULT_GRAPH_MAX_TOKENS, 1, outputTokenLimit) } : {}),
    ...(providerValue === "qwen" && env.GRAPH_TEMPERATURE !== undefined ? { temperature: boundedTemperature("GRAPH_TEMPERATURE", env.GRAPH_TEMPERATURE) } : {}),
  };
  if (providerValue === "openai") {
    for (const name of ["GRAPH_BASE_URL", "GRAPH_API_KEY", "GRAPH_ENABLE_THINKING", "GRAPH_MAX_TOKENS", "GRAPH_TEMPERATURE"]) {
      if (env[name] !== undefined) throw new TypeError(`${name} is not supported by the ChatGPT subscription Graph provider.`);
    }
    const accountId = env.GRAPH_ACCOUNT_ID === undefined ? (mainProvider === "openai" && "accountId" in mainAdapter ? mainAdapter.accountId : undefined) : env.GRAPH_ACCOUNT_ID.trim();
    if (env.GRAPH_ACCOUNT_ID !== undefined && !accountId) throw new TypeError("GRAPH_ACCOUNT_ID must be non-empty when provided.");
    return Object.freeze({ model, compatibilityProvider: providerValue, inputTokenBudget, outputTokenLimit,
      adapter: Object.freeze({ provider: "openai" as const, home, ...(accountId === undefined ? {} : { accountId }) }) });
  }
  if (env.GRAPH_ACCOUNT_ID !== undefined) throw new TypeError("GRAPH_ACCOUNT_ID is only supported by the ChatGPT subscription Graph provider.");
  if (providerValue === "deepseek") {
    const baseUrl = normalizeHttpUrl("GRAPH_BASE_URL", env.GRAPH_BASE_URL?.trim() || "https://api.deepseek.com");
    const sameEndpoint = mainProvider === "deepseek" && "baseUrl" in mainAdapter && mainAdapter.baseUrl === baseUrl;
    const apiKey = env.GRAPH_API_KEY ?? (sameEndpoint && "apiKey" in mainAdapter ? mainAdapter.apiKey : env.DEEPSEEK_API_KEY);
    if (!apiKey || /[\r\n]/.test(apiKey)) throw new TypeError("DeepSeek Graph requires a valid API key.");
    return Object.freeze({ model: { ...model, maxTokens: boundedIntegerRange("GRAPH_MAX_TOKENS", env.GRAPH_MAX_TOKENS,
      Math.min(DEFAULT_GRAPH_MAX_TOKENS, outputTokenLimit), 1, outputTokenLimit) },
      compatibilityProvider: providerValue, inputTokenBudget, outputTokenLimit,
      adapter: Object.freeze({ provider: "deepseek" as const, baseUrl, apiKey,
        enableThinking: optionalBoolean("GRAPH_ENABLE_THINKING", env.GRAPH_ENABLE_THINKING, true) }) });
  }
  const mainQwen = mainProvider === "qwen" && "baseUrl" in mainAdapter ? mainAdapter : undefined;
  const explicitBaseUrl = env.GRAPH_BASE_URL?.trim();
  const baseUrl = explicitBaseUrl ?? mainQwen?.baseUrl;
  if (baseUrl === undefined) throw new TypeError("GRAPH_BASE_URL is required for a Qwen Graph when Main does not use Qwen.");
  const normalizedBaseUrl = normalizeHttpUrl("GRAPH_BASE_URL", baseUrl);
  const sameEndpoint = mainQwen !== undefined && normalizeHttpUrl("LLM_BASE_URL", mainQwen.baseUrl) === normalizedBaseUrl;
  const graphApiKey = env.GRAPH_API_KEY ?? (sameEndpoint ? mainQwen?.apiKey : undefined);
  if (graphApiKey !== undefined && (graphApiKey.length === 0 || /[\r\n]/.test(graphApiKey))) throw new TypeError("GRAPH_API_KEY must be non-empty and must not contain newlines.");
  const enableThinking = env.GRAPH_ENABLE_THINKING === undefined
    ? sameEndpoint && mainQwen !== undefined ? mainQwen.enableThinking ?? false : false
    : optionalBoolean("GRAPH_ENABLE_THINKING", env.GRAPH_ENABLE_THINKING, false);
  return Object.freeze({ model, compatibilityProvider: providerValue, inputTokenBudget, outputTokenLimit,
    adapter: Object.freeze({ provider: "qwen" as const, baseUrl: normalizedBaseUrl, enableThinking,
      ...(graphApiKey === undefined ? {} : { apiKey: graphApiKey }) }) });
}

function boundedTemperature(name: string, value: string): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || parsed > 2) throw new TypeError(`${name} must be a number from 0 through 2.`);
  return parsed;
}

function normalizeHttpUrl(name: string, value: string): string {
  let url: URL;
  try { url = new URL(value); } catch (cause: unknown) { throw new TypeError(`${name} must be an absolute HTTP(S) URL.`, { cause }); }
  if ((url.protocol !== "http:" && url.protocol !== "https:") || url.username || url.password) throw new TypeError(`${name} must be an HTTP(S) URL without credentials.`);
  return url.href.replace(/\/$/, "");
}

function boundedInteger(
  name: string,
  value: string | undefined,
  fallback: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new TypeError(`${name} must be an integer from 1 through ${maximum}.`);
  }
  return parsed;
}

function boundedIntegerRange(
  name: string,
  value: string | undefined,
  fallback: number,
  minimum: number,
  maximum: number,
): number {
  const parsed = value === undefined ? fallback : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new TypeError(`${name} must be an integer from ${minimum} through ${maximum}.`);
  }
  return parsed;
}

function optionalInteger(name: string, value: string | undefined, maximum: number): number | undefined {
  return value === undefined ? undefined : boundedInteger(name, value.trim(), 0, maximum);
}

function optionalBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new TypeError(`${name} must be 'true' or 'false'.`);
}
