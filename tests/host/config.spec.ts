import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { describe, expect, it } from "vitest";

import { resolveKernelHostConfig } from "../../src/host/config.js";

describe("Kernel Host storage config", () => {
  it("stores Navo state under the user home by default", () => {
    expect(resolveKernelHostConfig({}).storage).toEqual({ path: join(homedir(), ".navo", "navo.db") });
  });

  it("accepts a trimmed NAVO_HOME override and rejects a blank one", () => {
    expect(resolveKernelHostConfig({ NAVO_HOME: "  relative-home  " }).storage)
      .toEqual({ path: join(resolve("relative-home"), "navo.db") });
    expect(() => resolveKernelHostConfig({ NAVO_HOME: "  " }))
      .toThrow("NAVO_HOME must be a non-empty path when provided.");
  });
});

describe("Kernel Host subscription configuration", () => {
  it("selects the requested model without Qwen defaults and shares the credential home", () => {
    const config = resolveKernelHostConfig({ LLM_PROVIDER: "openai", LLM_MODEL: " gpt-6-luna ",
      NAVO_HOME: " ./subscription-home ", LLM_ACCOUNT_ID: " saved-account " });
    expect(config).toMatchObject({ provider: "openai",
      adapter: { home: resolve("subscription-home"), accountId: "saved-account" },
      agent: { model: { provider: "openai", model: "gpt-6-luna" } } });
    expect(config.agent.model).not.toHaveProperty("maxTokens");
    expect(config.adapter).not.toHaveProperty("baseUrl");
  });

  it("declares context capacity and a compaction limit for either provider", () => {
    expect(resolveKernelHostConfig({}).agent.model).not.toHaveProperty("contextWindow");
    expect(resolveKernelHostConfig({ LLM_CONTEXT_WINDOW: " 262144 ", LLM_AUTO_COMPACT_LIMIT: "200000" }).agent.model)
      .toEqual({ provider: "qwen", model: "qwen3.8-27b", maxTokens: 8_192, contextWindow: 262_144, autoCompactLimit: 200_000 });
    expect(resolveKernelHostConfig({ LLM_PROVIDER: "openai", LLM_MODEL: "gpt-6-luna", LLM_CONTEXT_WINDOW: "272000" }).agent.model)
      .toEqual({ provider: "openai", model: "gpt-6-luna", contextWindow: 272_000 });
    for (const value of ["", "0", "-1", "1.5", "abc", "10000001"]) {
      expect(() => resolveKernelHostConfig({ LLM_CONTEXT_WINDOW: value })).toThrow("LLM_CONTEXT_WINDOW");
      expect(() => resolveKernelHostConfig({ LLM_AUTO_COMPACT_LIMIT: value })).toThrow("LLM_AUTO_COMPACT_LIMIT");
    }
  });

  it("requires an explicit OpenAI model and rejects unsupported configuration", () => {
    expect(() => resolveKernelHostConfig({ LLM_PROVIDER: "unknown" })).toThrow("LLM_PROVIDER");
    expect(() => resolveKernelHostConfig({ LLM_PROVIDER: "openai" })).toThrow("LLM_MODEL");
    for (const name of ["LLM_MAX_TOKENS", "LLM_TEMPERATURE", "LLM_ENABLE_THINKING", "LLM_API_KEY", "LLM_BASE_URL"]) {
      expect(() => resolveKernelHostConfig({ LLM_PROVIDER: "openai", LLM_MODEL: "gpt-6-luna", [name]: "value" }))
        .toThrow(name);
    }
    expect(() => resolveKernelHostConfig({ LLM_PROVIDER: "openai", LLM_MODEL: "gpt-6-luna", LLM_ACCOUNT_ID: " " }))
      .toThrow("LLM_ACCOUNT_ID");
  });
});
