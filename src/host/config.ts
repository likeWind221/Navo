import { homedir } from "node:os";
import { join, resolve } from "node:path";

import type { AgentTurnHandlerConfig } from "./turn.js";
import type { QwenChatAdapterConfig } from "../llm/adapters/qwen.js";
import { WEB_SEARCH_TOOL_NAME } from "../tools/builtins/search/tool.js";
import { WEB_FETCH_TOOL_NAME } from "../tools/builtins/fetch/tool.js";
import { FILE_TOOL_SCHEMAS } from "../tools/builtins/file/types.js";

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

export type KernelHostConfig = KernelHostCommonConfig & (
  | { readonly provider: "qwen"; readonly adapter: QwenChatAdapterConfig }
  | { readonly provider: "openai"; readonly adapter: { readonly home: string; readonly accountId?: string } }
);

interface KernelHostCommonConfig {
  readonly storage: KernelHostStorageConfig;
  readonly agent: AgentTurnHandlerConfig;
  readonly search?: KernelHostSearchConfig;
  readonly file?: KernelHostFileConfig;
}

const DEFAULT_BASE_URL = "http://192.168.99.2:8090/v1";
const DEFAULT_MODEL = "qwen3.8-27b";
const DEFAULT_MAX_TOKENS = 8_192;
const MAX_OUTPUT_TOKENS = 65_536;

/** Resolve trusted process environment once so credentials stay inside Host. */
export function resolveKernelHostConfig(
  env: NodeJS.ProcessEnv = process.env,
): KernelHostConfig {
  const provider = env.LLM_PROVIDER?.trim() ?? "qwen";
  if (provider !== "qwen" && provider !== "openai") {
    throw new TypeError("LLM_PROVIDER must be 'qwen' or 'openai'.");
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
  const model = env.LLM_MODEL?.trim() || DEFAULT_MODEL;
  const modelConfig = provider === "openai" ? { provider, model } : {
    provider, model, maxTokens: boundedInteger("LLM_MAX_TOKENS", env.LLM_MAX_TOKENS, DEFAULT_MAX_TOKENS, MAX_OUTPUT_TOKENS),
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
  return Object.freeze({
    storage,
    ...(provider === "openai" ? {
      provider,
      adapter: Object.freeze({ home, ...(env.LLM_ACCOUNT_ID === undefined ? {} : { accountId: env.LLM_ACCOUNT_ID.trim() }) }),
    } : {
      provider,
      adapter: Object.freeze({
        baseUrl: env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL,
        enableThinking: optionalBoolean("LLM_ENABLE_THINKING", env.LLM_ENABLE_THINKING, true),
        ...(apiKey === undefined ? {} : { apiKey }),
      }),
    }),
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
    file,
  });
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

function optionalBoolean(name: string, value: string | undefined, fallback: boolean): boolean {
  if (value === undefined) return fallback;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new TypeError(`${name} must be 'true' or 'false'.`);
}
