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
}

export interface KernelHostConfig {
  readonly provider: "qwen";
  readonly adapter: QwenChatAdapterConfig;
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
  const baseUrl = env.LLM_BASE_URL?.trim() || DEFAULT_BASE_URL;
  const model = env.LLM_MODEL?.trim() || DEFAULT_MODEL;
  const maxTokens = boundedInteger(
    "LLM_MAX_TOKENS",
    env.LLM_MAX_TOKENS,
    DEFAULT_MAX_TOKENS,
    MAX_OUTPUT_TOKENS,
  );
  const enableThinking = optionalBoolean("LLM_ENABLE_THINKING", env.LLM_ENABLE_THINKING, true);
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
  const file = Object.freeze({ cwd: fileCwd?.trim() ?? process.cwd() });
  return Object.freeze({
    provider: "qwen",
    adapter: Object.freeze({
      baseUrl,
      enableThinking,
      ...(apiKey === undefined ? {} : { apiKey }),
    }),
    agent: Object.freeze({
      model: Object.freeze({ provider: "qwen", model, maxTokens }),
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
