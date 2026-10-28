import { DeepSeekAdapter } from "../src/llm/adapters/deepseek.js";
import type { KernelHostConfig } from "../src/host/config.js";
import { resolveKernelHostConfig } from "../src/host/config.js";
import { OpenAIAdapter } from "../src/llm/adapters/openai.js";
import { ChatGPTAuth } from "../src/llm/auth/chatgpt.js";

export const REAL_ACCEPTANCE_MODEL = "gpt-6-luna";

type AcceptanceHostConfig = Extract<KernelHostConfig, { readonly provider: "openai" | "deepseek" }>;

const incompatibleVariables = [
  "LLM_MAX_TOKENS",
  "LLM_TEMPERATURE",
  "LLM_ENABLE_THINKING",
  "LLM_API_KEY",
  "LLM_BASE_URL",
] as const;

export function createAcceptanceEnvironment(
  env: NodeJS.ProcessEnv = process.env,
  model = REAL_ACCEPTANCE_MODEL,
): NodeJS.ProcessEnv {
  if (env.LLM_PROVIDER === "deepseek") return { ...env, LLM_MODEL: env.LLM_MODEL?.trim() || "deepseek-flash" };
  const result: NodeJS.ProcessEnv = {
    ...env,
    LLM_PROVIDER: "openai",
    LLM_MODEL: model,
  };
  for (const name of incompatibleVariables) delete result[name];
  return result;
}

export function resolveAcceptanceHostConfig(
  env: NodeJS.ProcessEnv = process.env,
  model = REAL_ACCEPTANCE_MODEL,
): AcceptanceHostConfig {
  const config = resolveKernelHostConfig(createAcceptanceEnvironment(env, model));
  if (config.provider !== "openai" && config.provider !== "deepseek") throw new Error("Real acceptance requires OpenAI subscription or DeepSeek.");
  return config;
}

export function createAcceptanceAdapter(config: AcceptanceHostConfig): OpenAIAdapter | DeepSeekAdapter {
  if (config.provider === "deepseek") return new DeepSeekAdapter(config.adapter);
  return new OpenAIAdapter({
    auth: new ChatGPTAuth({
      home: config.adapter.home,
      openBrowser: async () => { throw new Error("Run pnpm chatgpt login first."); },
    }),
    ...(config.adapter.accountId === undefined ? {} : { accountId: config.adapter.accountId }),
  });
}
